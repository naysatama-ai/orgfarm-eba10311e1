@IsTest
private class RfpIntakeControllerTest {
    private static final String MODEL_JSON = '```json\n{'
        + '"opportunityName": {"value": "Acme Sports Drinks - Q4 Holiday Audio", "confidence": "high", "evidence": "Q4 Holiday Push"},'
        + '"advertiserName": {"value": "Acme Sports Drinks", "confidence": "high", "evidence": "Client: Acme"},'
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
        + '"agencyName": {"value": "Mindshare USA", "confidence": "high", "evidence": "Mindshare USA"},'
        + '"summary": {"value": ["Drive promo code redemptions", "Host-read ads preferred"], "confidence": "high", "evidence": ""}'
        + '}\n```';

    @TestSetup
    static void setup() {
        Account advertiser = new Account(Name = 'Acme Sports Drinks');
        Account agency = new Account(Name = 'Mindshare');
        Account other = new Account(Name = 'Globex Foods');
        insert new List<Account>{ advertiser, agency, other };
        insert new Opportunity(
            Name = 'Acme Existing Deal',
            AccountId = advertiser.Id,
            StageName = 'Prospecting',
            CloseDate = Date.today().addDays(30)
        );
    }

    private static Id accountId(String name) {
        return [SELECT Id FROM Account WHERE Name = :name].Id;
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
    static void extractBuildsNewOpportunityFromRfp() {
        RfpIntakeController.mockModelResponse = MODEL_JSON;
        Test.startTest();
        RfpIntakeController.ExtractionResult r = RfpIntakeController.extract(null, 'Agency brief text');
        Test.stopTest();

        System.assertEquals('Acme Sports Drinks - Q4 Holiday Audio', find(r, 'Name').value);
        System.assertEquals(accountId('Acme Sports Drinks'), find(r, 'AccountId').value);
        System.assertNotEquals(null, find(r, 'StageName').value);
        System.assertEquals('2026-10-12', find(r, 'CloseDate').value);
        System.assertEquals('450000', find(r, 'Amount').value);
        System.assert(find(r, 'Name').required && find(r, 'StageName').required && find(r, 'CloseDate').required);

        System.assertEquals('450000', find(r, 'Gross_Budget__c').value);
        System.assertEquals(null, find(r, 'RFP_Due_Date__c').value);
        System.assertEquals('low', find(r, 'RFP_Due_Date__c').confidence);
        System.assertEquals('Direct Response', find(r, 'Primary_KPI__c').value);
        System.assertEquals('Sports;Comedy', find(r, 'Content_Categories__c').value);
        System.assertEquals('Podcast;Streaming Audio', find(r, 'Channels__c').value);
        System.assertEquals('18000000', find(r, 'Impressions_Goal__c').value);
        System.assertEquals('none', find(r, 'Target_CPM__c').confidence);
        System.assertEquals(accountId('Mindshare'), find(r, 'Agency__c').value);
        System.assertEquals('medium', find(r, 'Agency__c').confidence);
        System.assert(find(r, 'RFP_Summary__c').value.contains('\n- Host-read ads preferred'));

        System.assertEquals(1, r.warnings.size(), 'Expected open-opportunity duplicate warning');
        System.assert(r.warnings[0].contains('Acme Existing Deal'));
    }

    @IsTest
    static void extractUsesAccountPageContextAndWarnsOnMismatch() {
        RfpIntakeController.mockModelResponse = MODEL_JSON;
        Id globex = accountId('Globex Foods');
        RfpIntakeController.ExtractionResult r = RfpIntakeController.extract(globex, 'text');
        System.assertEquals(globex, find(r, 'AccountId').value);
        System.assertEquals('low', find(r, 'AccountId').confidence);
        System.assertEquals(1, r.warnings.size());
        System.assert(r.warnings[0].contains('Globex Foods'));
    }

    @IsTest
    static void extractFallsBackWhenRfpIsSparse() {
        RfpIntakeController.mockModelResponse = '{"advertiserName": "Brand New Co", "agencyName": "Nonexistent Media"}';
        RfpIntakeController.ExtractionResult r = RfpIntakeController.extract(null, 'text');
        System.assert(find(r, 'Name').value.startsWith('Brand New Co - RFP'));
        System.assertEquals(null, find(r, 'AccountId').value);
        System.assertEquals('low', find(r, 'AccountId').confidence);
        System.assertEquals(String.valueOf(Date.today().addDays(30)), find(r, 'CloseDate').value);
        System.assertEquals(null, find(r, 'Amount').value);
        System.assertEquals(null, find(r, 'Agency__c').value);
        System.assert(r.warnings.isEmpty());
    }

    @IsTest
    static void extractRejectsBlankAndUnreadableInput() {
        Boolean blankFailed = false;
        try {
            RfpIntakeController.extract(null, '   ');
        } catch (AuraHandledException e) {
            blankFailed = true;
        }
        System.assert(blankFailed);

        RfpIntakeController.mockModelResponse = 'Sorry, I cannot help with that.';
        Boolean badJsonFailed = false;
        try {
            RfpIntakeController.extract(null, 'text');
        } catch (AuraHandledException e) {
            badJsonFailed = true;
        }
        System.assert(badJsonFailed);
    }

    @IsTest
    static void createOpportunityInsertsRecordAndAttachesFile() {
        Id agency = accountId('Mindshare');
        Map<String, String> values = new Map<String, String>{
            'Name' => 'Acme - Q4 Holiday Audio',
            'AccountId' => accountId('Acme Sports Drinks'),
            'StageName' => 'Prospecting',
            'CloseDate' => '2026-10-12',
            'Amount' => '450000',
            'Gross_Budget__c' => '450000',
            'Flight_Start_Date__c' => '2026-10-12',
            'Primary_KPI__c' => 'Direct Response',
            'Channels__c' => 'Podcast;Streaming Audio',
            'Agency__c' => agency,
            'Target_CPM__c' => '',
            'Probability' => '99'
        };

        Test.startTest();
        Id oppId = RfpIntakeController.createOpportunity(
            values, null, 'brief.txt', EncodingUtil.base64Encode(Blob.valueOf('brief'))
        );
        Test.stopTest();

        Opportunity o = [
            SELECT Name, AccountId, StageName, CloseDate, Amount, Gross_Budget__c, Flight_Start_Date__c,
                Primary_KPI__c, Channels__c, Agency__c, Target_CPM__c, Probability, RFP_Processed_On__c
            FROM Opportunity WHERE Id = :oppId
        ];
        System.assertEquals('Acme - Q4 Holiday Audio', o.Name);
        System.assertEquals(accountId('Acme Sports Drinks'), o.AccountId);
        System.assertEquals(Date.newInstance(2026, 10, 12), o.CloseDate);
        System.assertEquals(450000, o.Amount);
        System.assertEquals(450000, o.Gross_Budget__c);
        System.assertEquals('Direct Response', o.Primary_KPI__c);
        System.assertEquals('Podcast;Streaming Audio', o.Channels__c);
        System.assertEquals(agency, o.Agency__c);
        System.assertEquals(null, o.Target_CPM__c);
        System.assertNotEquals(99, o.Probability, 'Fields outside the RFP set must be ignored');
        System.assertNotEquals(null, o.RFP_Processed_On__c);
        System.assertEquals(1, [SELECT COUNT() FROM ContentDocumentLink WHERE LinkedEntityId = :oppId]);
    }

    @IsTest
    static void createOpportunityCanCreateTheAdvertiserAccount() {
        Id oppId = RfpIntakeController.createOpportunity(
            new Map<String, String>{ 'Name' => 'Brand New - Q1', 'StageName' => 'Prospecting', 'CloseDate' => '2026-12-01' },
            'Brand New Co',
            null,
            null
        );
        Opportunity o = [SELECT Account.Name FROM Opportunity WHERE Id = :oppId];
        System.assertEquals('Brand New Co', o.Account.Name);
    }

    @IsTest
    static void createOpportunityRequiresCoreFields() {
        Boolean failed = false;
        try {
            RfpIntakeController.createOpportunity(new Map<String, String>{ 'Name' => 'Missing stage' }, null, null, null);
        } catch (AuraHandledException e) {
            failed = true;
        }
        System.assert(failed);
    }

    @IsTest
    static void normalizeNumberHandlesSuffixes() {
        System.assertEquals(1200000, RfpIntakeController.normalizeNumber('$1.2M'));
        System.assertEquals(18000000, RfpIntakeController.normalizeNumber('18MM'));
        System.assertEquals(25.5, RfpIntakeController.normalizeNumber('25.50 USD'));
        System.assertEquals(null, RfpIntakeController.normalizeNumber('TBD'));
    }
}
