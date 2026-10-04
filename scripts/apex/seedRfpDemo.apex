List<Account> existing = [SELECT Id, Name FROM Account WHERE Name IN ('Volt Energy Drinks', 'Mindshare')];
Map<String, Account> byName = new Map<String, Account>();
for (Account a : existing) {
    byName.put(a.Name, a);
}
if (!byName.containsKey('Volt Energy Drinks')) {
    byName.put('Volt Energy Drinks', new Account(Name = 'Volt Energy Drinks', Industry = 'Food & Beverage', Type = 'Customer - Direct'));
}
if (!byName.containsKey('Mindshare')) {
    byName.put('Mindshare', new Account(Name = 'Mindshare', Industry = 'Media', Type = 'Other', Description = 'Media agency (WPP / GroupM).'));
}
upsert byName.values();

Account volt = byName.get('Volt Energy Drinks');
List<Opportunity> opps = [SELECT Id FROM Opportunity WHERE Name = 'Volt Energy - Q4 Holiday Audio' LIMIT 1];
Opportunity opp = opps.isEmpty()
    ? new Opportunity(Name = 'Volt Energy - Q4 Holiday Audio', AccountId = volt.Id, StageName = 'Qualification', CloseDate = Date.today().addDays(14))
    : opps[0];
opp.Amount = null;
for (String field : new List<String>{
    'Gross_Budget__c', 'Flight_Start_Date__c', 'Flight_End_Date__c', 'RFP_Due_Date__c', 'Primary_KPI__c',
    'Target_Demo__c', 'Content_Categories__c', 'Channels__c', 'Impressions_Goal__c', 'Target_CPM__c',
    'Agency__c', 'RFP_Summary__c', 'RFP_Processed_On__c'
}) {
    opp.put(field, null);
}
upsert opp;

List<ContentDocumentLink> links = [SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = :opp.Id];
Set<Id> docIds = new Set<Id>();
for (ContentDocumentLink l : links) {
    docIds.add(l.ContentDocumentId);
}
delete [SELECT Id FROM ContentDocument WHERE Id IN :docIds];
System.debug('DEMO_OPP=' + opp.Id);
