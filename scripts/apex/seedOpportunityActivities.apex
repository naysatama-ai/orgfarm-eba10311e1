Id oppId = '006bm00000WdMkwAAF';
Opportunity opp = [SELECT Id, OwnerId, AccountId FROM Opportunity WHERE Id = :oppId];
List<Contact> contacts = [SELECT Id FROM Contact WHERE AccountId = :opp.AccountId LIMIT 1];
Id whoId = contacts.isEmpty() ? null : contacts[0].Id;
Date today = Date.today();
DateTime now = DateTime.now();

List<Task> tasks = new List<Task>{
    new Task(Subject = 'Call', TaskSubtype = 'Call', Status = 'Completed', Priority = 'Normal',
        ActivityDate = today.addDays(-14), CallType = 'Outbound', CallDurationInSeconds = 900,
        Description = 'Intro call with facilities team about campus-wide installation scope.'),
    new Task(Subject = 'Email: Proposal draft sent', TaskSubtype = 'Email', Status = 'Completed', Priority = 'Normal',
        ActivityDate = today.addDays(-10), Description = 'Sent initial proposal draft covering 3 buildings.'),
    new Task(Subject = 'Follow up on pricing questions', Status = 'Completed', Priority = 'High',
        ActivityDate = today.addDays(-7), Description = 'Clarified volume discount tiers and contract term options.'),
    new Task(Subject = 'Send revised quote', Status = 'In Progress', Priority = 'High',
        ActivityDate = today.addDays(2), Description = 'Include 12-month and 24-month term options.'),
    new Task(Subject = 'Confirm procurement contact', Status = 'Not Started', Priority = 'Normal',
        ActivityDate = today.addDays(5), Description = 'Identify who signs off in university procurement.'),
    new Task(Subject = 'Prepare ROI summary for CFO', Status = 'Not Started', Priority = 'High',
        ActivityDate = today.addDays(9), Description = 'One-page ROI summary for the budget committee.'),
    new Task(Subject = 'Overdue: Collect site survey results', Status = 'Waiting on someone else', Priority = 'Normal',
        ActivityDate = today.addDays(-2), Description = 'Waiting on facilities to share survey data.')
};
for (Task t : tasks) {
    t.WhatId = oppId;
    t.WhoId = whoId;
    t.OwnerId = opp.OwnerId;
}
insert tasks;

List<Event> events = new List<Event>{
    new Event(Subject = 'Discovery Meeting', Location = 'Zoom',
        StartDateTime = now.addDays(-12), EndDateTime = now.addDays(-12).addMinutes(60),
        Description = 'Discovery session with IT and facilities stakeholders.'),
    new Event(Subject = 'On-site Campus Walkthrough', Location = 'University of Arizona, Tucson',
        StartDateTime = now.addDays(-5), EndDateTime = now.addDays(-5).addMinutes(120),
        Description = 'Walked the three target buildings with facilities lead.'),
    new Event(Subject = 'Proposal Review with Stakeholders', Location = 'Zoom',
        StartDateTime = now.addDays(7), EndDateTime = now.addDays(7).addMinutes(45),
        Description = 'Review revised proposal and next steps toward contract.')
};
for (Event e : events) {
    e.WhatId = oppId;
    e.WhoId = whoId;
    e.OwnerId = opp.OwnerId;
}
insert events;

System.debug('Inserted ' + tasks.size() + ' tasks and ' + events.size() + ' events');
