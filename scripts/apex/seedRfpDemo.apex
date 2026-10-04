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

List<Opportunity> demoOpps = [
    SELECT Id
    FROM Opportunity
    WHERE AccountId = :byName.get('Volt Energy Drinks').Id
        AND (RFP_Processed_On__c != NULL OR Name = 'Volt Energy - Q4 Holiday Audio')
];
Set<Id> oppIds = new Map<Id, Opportunity>(demoOpps).keySet();
if (!oppIds.isEmpty()) {
    Set<Id> docIds = new Set<Id>();
    for (ContentDocumentLink l : [SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId IN :oppIds]) {
        docIds.add(l.ContentDocumentId);
    }
    delete [SELECT Id FROM ContentDocument WHERE Id IN :docIds];
    delete demoOpps;
}
System.debug('DEMO_READY removed ' + demoOpps.size() + ' demo opportunities');
