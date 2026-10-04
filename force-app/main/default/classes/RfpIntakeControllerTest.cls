@IsTest
private class RfpIntakeControllerTest {
    private static final String MODEL_JSON = '```json\n{'
        + '"grossBudget": {"value": "$450K", "confidence": "high", "evidence": "Gross budget: $450,000"},'
        + '"flightStart": {"value": "2026-10-12", "confidence": "high", "evidence": "Flight: Oct 12"},'
        + '"flightEnd": {"value": "2026-12-25", "confidence": "high", "evidence": "through Dec 25"},'
        + '"rfpDueDate": {"value": "not a date", "confidence": "high", "evidence": "ASAP"},'
        + '"primaryKpi": {"value": "direct response", "confidence": "medium", "evidence": "promo code"},'
        + '"targetDemo": {"value": "Adults 25-49", "confidence": "high", "evidence": "A25-49"},'
        + '"contentCategories": {"value": ["Sports", "Comedy", "Cooking"], "confidence": "high", "evidence": "sports and comedy"},'
        + '"channels": {"value": "Podcast; Streaming Audio", "confidence": "high", "evidence": "podcast and streaming"},'
        + '"impressionsGoal": {"value": 18000000, "confidence": "high", "evidence": "18MM impressions"},'
        + '"targetCpm": {"value": null, "confidence": "low", "evidence": null},'
        + '"agencyName": {"value": "Mindshare", "confidence": "high", "evidence": "Mindshare USA"},'
        + '"summary": {"value": ["Drive promo code redemptions", "Host-read ads preferred"], "confidence": "high", "evidence": ""},'
        + '"advertiserName": {"value": "Acme Sports Drinks", "confidence": "high", "evidence": "Acme"}'
        + '}\n```';

    @TestSetup
    static void setup() {
        Account advertiser = new Account(Name = 'Globex Foods');
        Account agency = new Account(Name = 'Mindshare');
        insert new List<Account>{ advertiser, agency };
        insert new Opportunity(
            Name = 'Globex Q4 Audio',
            AccountId = advertiser.Id,
            StageName = 'Prospecting',
            CloseDate = Date.today().addDays(30),
            Amount = 1000
        );
    }

    private static Opportunity opp() {
        return [SELECT Id FROM Opportunity LIMIT 1];
    }

    private static RfpIntakeController.FieldSuggestion find(RfpIntakeController.ExtractionResult r, String field) {
        for (RfpIntakeController.FieldSuggestion s : r.fields) {
            if (s.fieldApiName == field) {
                return s;
            }
        }
        return null;
    }

    @IsTest
    static void extractNormalizesModelOutput() {
        RfpIntakeController.mockModelResponse = MODEL_JSON;
        Test.startTest();
        RfpIntakeController.ExtractionResult r = RfpIntakeController.extract(opp().Id, 'Agency brief text');
        Test.stopTest();

        Account agency = [SELECT Id FROM Account WHERE Name = 'Mindshare'];
        System.assertEquals('450000', find(r, 'Gross_Budget__c').value);
        System.assertEquals('2026-10-12', find(r, 'Flight_Start_Date__c').value);
        System.assertEquals(null, find(r, 'RFP_Due_Date__c').value);
        System.assertEquals('low', find(r, 'RFP_Due_Date__c').confidence);
        System.assertEquals('Direct Response', find(r, 'Primary_KPI__c').value);
        System.assertEquals('Sports;Comedy', find(r, 'Content_Categories__c').value);
        System.assertEquals('Podcast;Streaming Audio', find(r, 'Channels__c').value);
        System.assertEquals('18000000', find(r, 'Impressions_Goal__c').value);
        System.assertEquals('none', find(r, 'Target_CPM__c').confidence);
        System.assertEquals(agency.Id, find(r, 'Agency__c').value);
        System.assert(find(r, 'RFP_Summary__c').value.contains('\n- Host-read ads preferred'));
        System.assertEquals('Acme Sports Drinks', r.advertiserName);
        System.assertEquals(1, r.warnings.size(), 'Expected advertiser mismatch warning');
    }

    @IsTest
    static void extractFlagsUnknownAgency() {
        RfpIntakeController.mockModelResponse = '{"agencyName": "Nonexistent Media Co"}';
        RfpIntakeController.ExtractionResult r = RfpIntakeController.extract(opp().Id, 'text');
        RfpIntakeController.FieldSuggestion agency = find(r, 'Agency__c');
        System.assertEquals(null, agency.value);
        System.assertEquals('low', agency.confidence);
        System.assertNotEquals(null, agency.note);
    }

    @IsTest
    static void extractMatchesAgencyByPartialName() {
        RfpIntakeController.mockModelResponse = '{"agencyName": {"value": "Mindshare USA", "confidence": "high"}}';
        RfpIntakeController.ExtractionResult r = RfpIntakeController.extract(opp().Id, 'text');
        RfpIntakeController.FieldSuggestion agency = find(r, 'Agency__c');
        System.assertEquals([SELECT Id FROM Account WHERE Name = 'Mindshare'].Id, agency.value);
        System.assertEquals('medium', agency.confidence);
    }

    @IsTest
    static void extractRejectsBlankAndUnreadableInput() {
        Boolean blankFailed = false;
        try {
            RfpIntakeController.extract(opp().Id, '   ');
        } catch (AuraHandledException e) {
            blankFailed = true;
        }
        System.assert(blankFailed);

        RfpIntakeController.mockModelResponse = 'Sorry, I cannot help with that.';
        Boolean badJsonFailed = false;
        try {
            RfpIntakeController.extract(opp().Id, 'text');
        } catch (AuraHandledException e) {
            badJsonFailed = true;
        }
        System.assert(badJsonFailed);
    }

    @IsTest
    static void applyValuesUpdatesOpportunityAndAttachesFile() {
        Account agency = [SELECT Id FROM Account WHERE Name = 'Mindshare'];
        Id oppId = opp().Id;
        Map<String, String> values = new Map<String, String>{
            'Gross_Budget__c' => '450000',
            'Flight_Start_Date__c' => '2026-10-12',
            'Primary_KPI__c' => 'Direct Response',
            'Channels__c' => 'Podcast;Streaming Audio',
            'Agency__c' => agency.Id,
            'Target_CPM__c' => '',
            'Name' => 'Should be ignored'
        };

        Test.startTest();
        RfpIntakeController.applyValues(oppId, values, true, 'brief.txt', EncodingUtil.base64Encode(Blob.valueOf('brief')));
        Test.stopTest();

        Opportunity o = [
            SELECT Name, Amount, Gross_Budget__c, Flight_Start_Date__c, Primary_KPI__c, Channels__c, Agency__c, RFP_Processed_On__c
            FROM Opportunity WHERE Id = :oppId
        ];
        System.assertEquals('Globex Q4 Audio', o.Name);
        System.assertEquals(450000, o.Amount);
        System.assertEquals(450000, o.Gross_Budget__c);
        System.assertEquals(Date.newInstance(2026, 10, 12), o.Flight_Start_Date__c);
        System.assertEquals('Direct Response', o.Primary_KPI__c);
        System.assertEquals('Podcast;Streaming Audio', o.Channels__c);
        System.assertEquals(agency.Id, o.Agency__c);
        System.assertNotEquals(null, o.RFP_Processed_On__c);
        System.assertEquals(1, [SELECT COUNT() FROM ContentDocumentLink WHERE LinkedEntityId = :oppId]);

        RfpIntakeController.mockModelResponse = '{}';
        RfpIntakeController.ExtractionResult again = RfpIntakeController.extract(oppId, 'text');
        System.assertEquals('2026-10-12', find(again, 'Flight_Start_Date__c').currentValue);
        System.assertEquals('Mindshare', find(again, 'Agency__c').currentValue);
    }

    @IsTest
    static void applyValuesLeavesAmountWhenNotRequested() {
        Id oppId = opp().Id;
        RfpIntakeController.applyValues(oppId, new Map<String, String>{ 'Gross_Budget__c' => '5000' }, false, null, null);
        Opportunity o = [SELECT Amount, Gross_Budget__c FROM Opportunity WHERE Id = :oppId];
        System.assertEquals(1000, o.Amount);
        System.assertEquals(5000, o.Gross_Budget__c);
    }

    @IsTest
    static void normalizeNumberHandlesSuffixes() {
        System.assertEquals(1200000, RfpIntakeController.normalizeNumber('$1.2M'));
        System.assertEquals(18000000, RfpIntakeController.normalizeNumber('18MM'));
        System.assertEquals(25.5, RfpIntakeController.normalizeNumber('25.50 USD'));
        System.assertEquals(null, RfpIntakeController.normalizeNumber('TBD'));
    }
}
