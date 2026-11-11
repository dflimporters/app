// DFL Training Course — the workbook content. Read by /training/course.html.
// Completions are stored by module key in training_completions
// (_staging/sql/2026-11-11_training_course.sql), so:
//   • never rename a module key once people have completed it (it would reset them);
//   • editing a lesson's words or adding a question is fine;
//   • a new module = add it here and to a track's list.
// Every quiz question must be answered correctly before "Mark complete" unlocks.
// `answer` is the 0-based index of the correct option.
window.DFL_COURSE = {
  version: '2026-11-11',
  tracks: {
    ba: {
      title: 'Brand Ambassador Training',
      who: 'For Brand Ambassadors and relief Brand Ambassadors',
      modules: ['ba-start', 'ba-visit', 'ba-stock', 'ba-numbers', 'ba-requests', 'ba-tools']
    },
    tl: {
      title: 'Team Leader Training',
      who: 'For Team Leaders and Team Leader + Brand Ambassadors',
      modules: ['ba-start', 'ba-visit', 'ba-stock', 'ba-numbers', 'ba-requests', 'ba-tools',
                'tl-dashboard', 'tl-audits', 'tl-routes', 'tl-leave', 'tl-days']
    }
  },

  modules: {

    'ba-start': {
      title: 'Getting started', icon: '📱', minutes: 5,
      intro: 'How to sign in, what is on your home screen, and what the status dots mean.',
      sections: [
        { h: 'Signing in', html:
          '<ol><li>Go to <b>dflhq.com</b> on your phone. There is no separate app to install.</li>' +
          '<li>Enter your phone number and type in the SMS code you receive.</li>' +
          '<li>First time? Your account is created automatically. A team leader or admin may need to approve it before you see your stores.</li></ol>' +
          '<p class="tip"><b>Tip:</b> add dflhq.com to your home screen so it opens like an app.</p>' },
        { h: 'Your home screen', html:
          '<ul><li><b>Today at a glance:</b> visits today, issues flagged, stores achieving and your period achievement.</li>' +
          '<li><b>Your commission</b> card (or <b>relief incentive</b> card if you earn one).</li>' +
          '<li>Two big buttons: <b>📍 Log a Visit</b> and <b>🏪 My Stores</b>.</li>' +
          '<li>Below them: Report OOS, Report an Issue, My stock counts, Delivery Reports, Quarterly Evaluation, Request Leave, Events &amp; Training, Stock &amp; Prices, Catalogue and Planograms.</li>' +
          '<li><b>Today\'s visits</b> at the bottom. Tap <b>Continue visit →</b> to finish one you started.</li></ul>' },
        { h: 'Status dots and offline', html:
          '<ul><li>The <b>location</b> dot shows whether your GPS has a fix. The <b>online</b> dot shows whether you have signal.</li>' +
          '<li>Neither one stops you working. With no signal, visits wait on your phone with an amber <b>⏳ unsynced</b> badge and send themselves when you are back online. Tap the badge to send them straight away.</li>' +
          '<li>If GPS cannot lock, the visit is still logged, just without coordinates.</li></ul>' }
      ],
      quiz: [
        { q: 'How do you sign in to the merch app?', options: ['With a username and password', 'At dflhq.com with your phone number and an SMS code', 'By downloading an app from the store'], answer: 1 },
        { q: 'Your visit shows "⏳ 1 unsynced". What does that mean?', options: ['The visit was lost and must be redone', 'It is saved on your phone and will send when you have signal', 'Your team leader must approve it'], answer: 1 },
        { q: 'Your GPS will not lock at a store. What happens?', options: ['You cannot log the visit', 'The visit is logged without coordinates', 'The app closes'], answer: 1 }
      ]
    },

    'ba-visit': {
      title: 'Logging a store visit', icon: '📍', minutes: 8,
      intro: 'Every visit has four stages, always in this order: Log visit → Stock → Pictures → Close out.',
      sections: [
        { h: '1. Log visit (arrival)', html:
          '<p>Tap <b>Log a Visit</b>, search for your store and tap <b>Log visit — I\'ve arrived →</b> the moment you get there. This records your arrival time and location.</p>' +
          '<p class="tip"><b>Store missing?</b> Search only shows stores on your route. Tell your team leader so they can check your assignments.</p>' },
        { h: '2. Stock (optional)', html:
          '<p>A grid of product categories. Tap a tile once for <b>stocked</b> (green), again for <b>out of stock</b>, again to clear it. For exact quantities, tap the <b>Stock count</b> row (see the next module). You can always move on to Pictures.</p>' },
        { h: '3. Pictures (required)', html:
          '<p>The in-app camera opens. Take <b>at least 3 shelf photos</b> (up to 5). You cannot pick old photos from your gallery. Each shows <b>✓ Saved</b> once uploaded; tap × on one to retake it.</p>' +
          '<p><b>Next: Close out</b> stays grey until you have 3 photos.</p>' +
          '<p class="tip"><b>Best practice:</b> take your photos on the way out, once the shelf shows the work you just did.</p>' },
        { h: '4. Close out (departure)', html:
          '<p>Choose an outcome — <b>✓ All good</b>, <b>⚠ Issues</b> or <b>↩ Follow-up</b> — add notes (type, or tap 🎤 to speak), then tap <b>Close out — leaving store →</b>. <b>This is the step that finishes the visit.</b> A visit that is never closed out is not complete.</p>' },
        { h: 'Leaving and coming back', html:
          '<p>You can leave a visit and come back. Reopening it from <b>Today\'s visits</b> takes you to the stage where you stopped.</p>' }
      ],
      quiz: [
        { q: 'What is the correct order of a visit?', options: ['Pictures → Log visit → Stock → Close out', 'Log visit → Stock → Pictures → Close out', 'Log visit → Close out → Pictures'], answer: 1 },
        { q: 'How many shelf photos do you need before you can close out?', options: ['1', 'At least 3', 'None'], answer: 1 },
        { q: 'Which step actually finishes the visit?', options: ['Taking the last photo', 'Tapping Close out — leaving store', 'Logging arrival'], answer: 1 }
      ]
    },

    'ba-stock': {
      title: 'Stock tools', icon: '📦', minutes: 6,
      intro: 'Three different tools use the word "stock". Here is when to use each one.',
      sections: [
        { h: 'Which tool when', html:
          '<table><tr><th>Tool</th><th>Where</th><th>Use it to</th></tr>' +
          '<tr><td><b>Category tiles</b></td><td>Stage 2 of a visit</td><td>Quickly mark each category stocked or out of stock</td></tr>' +
          '<tr><td><b>Stock count</b></td><td>Stage 2\'s "Stock count" row, or <b>My stock counts</b> on Home</td><td>Count exact quantities per product and get a suggested reorder</td></tr>' +
          '<tr><td><b>Report OOS</b></td><td>Home</td><td>Flag specific products as out of stock or damaged, no visit needed</td></tr></table>' },
        { h: 'Using the stock count', html:
          '<ul><li>Opens that store\'s products, grouped in category tabs, with a search box.</li>' +
          '<li>Each line shows the last purchase and an average, with an urgency colour.</li>' +
          '<li>Enter what is in the storeroom; the app suggests a reorder quantity you can change.</li>' +
          '<li>You can count any time that day, during or after the visit.</li></ul>' },
        { h: 'Stock & Prices', html:
          '<p><b>📦 Stock &amp; Prices</b> on Home shows what DFL has in stock and the list price of every product, including deal-sheet offers. Use it before telling a store manager whether something can be ordered.</p>' }
      ],
      quiz: [
        { q: 'A store is out of one specific product and you are not on a visit. What do you use?', options: ['Category tiles', 'Report OOS', 'Close out notes'], answer: 1 },
        { q: 'Where do you count exact quantities and get a suggested reorder?', options: ['The stock count', 'Category tiles', 'Planograms'], answer: 0 },
        { q: 'Is Stage 2 (Stock) required to finish a visit?', options: ['Yes, always', 'No, it is optional', 'Only on Fridays'], answer: 1 }
      ]
    },

    'ba-numbers': {
      title: 'Your stores and your numbers', icon: '🏪', minutes: 5,
      intro: 'How to read your targets, achievement and commission.',
      sections: [
        { h: 'My Stores', html:
          '<p><b>🏪 My Stores</b> lists every store on your route with its target, sales so far this month and achievement %. Tap a store for more detail.</p>' },
        { h: 'The colour scale', html:
          '<p>The same colours are used everywhere progress is shown:</p>' +
          '<ul><li><span class="dot g"></span><b>Green</b> — 80% of target or above</li><li><span class="dot a"></span><b>Amber</b> — 50% to 79%</li><li><span class="dot r"></span><b>Red</b> — below 50%</li></ul>' },
        { h: 'Commission', html:
          '<p>Your <b>commission</b> card shows how many of your stores are at <b>80%+</b> and <b>100%+</b> of target, and the commission earned so far this month. Stores reaching those levels are what earn commission, so focus on the stores just below 80% and 100%.</p>' +
          '<p>If you earn the <b>relief incentive</b>, its card shows completed relief visits this month and the amount earned.</p>' },
        { h: 'Route changes', html:
          '<p>If a store is moving onto your route, a <b>📅 Route change coming</b> card shows it in advance. You cannot log visits there until the change starts.</p>' }
      ],
      quiz: [
        { q: 'A store is at 65% of target. What colour is it?', options: ['Green', 'Amber', 'Red'], answer: 1 },
        { q: 'Which stores earn commission?', options: ['Every store you visit', 'Stores at 80%+ and 100%+ of target', 'Only stores with no out-of-stocks'], answer: 1 },
        { q: 'Where do you see each store\'s target and achievement?', options: ['My Stores', 'Planograms', 'Report an Issue'], answer: 0 }
      ]
    },

    'ba-requests': {
      title: 'Issues, leave and events', icon: '🌴', minutes: 6,
      intro: 'How to report a problem, request leave, check deliveries and sign in to events.',
      sections: [
        { h: 'Report an Issue', html:
          '<p><b>🛠️ Report an Issue</b> is for problems with your work equipment: phone, uniform, tools, transport and more. Add a photo if it helps. Your team leader and admin see it and follow up.</p>' },
        { h: 'Request Leave', html:
          '<p><b>🌴 Request Leave</b>: choose vacation or sick, the dates and who can cover your stores, then submit. Your team leader approves or declines it, and you can see the status in the app. Request vacation as early as you can.</p>' },
        { h: 'Delivery Reports', html:
          '<p><b>🚚 Delivery Reports</b> shows whether a DFL delivery is out for one of your stores today, so you can plan when to be there.</p>' },
        { h: 'Events & Training', html:
          '<p><b>📅 Events &amp; Training</b> lists events and training you are invited to. When you attend, open it and tap <b>Sign in as attending</b>.</p>' },
        { h: 'Quarterly Evaluation', html:
          '<p>Each quarter you complete a <b>self-evaluation</b> in <b>📋 Quarterly Evaluation</b>. Your team leader then completes their review and you both sign off.</p>' }
      ],
      quiz: [
        { q: 'Your work phone screen is cracked. Where do you report it?', options: ['Report OOS', 'Report an Issue', 'Request Leave'], answer: 1 },
        { q: 'Who approves your leave request?', options: ['Your team leader', 'The store manager', 'Nobody, it is automatic'], answer: 0 },
        { q: 'You attended a training event. What should you do in the app?', options: ['Nothing', 'Open Events & Training and tap Sign in as attending', 'Log a visit'], answer: 1 }
      ]
    },

    'ba-tools': {
      title: 'Reference tools', icon: '📐', minutes: 4,
      intro: 'Tools to help you merchandise correctly.',
      sections: [
        { h: 'Planograms', html:
          '<p><b>📐 Planograms</b> show where each product belongs on the shelf, by category. Use them when setting up or fixing a shelf.</p>' },
        { h: 'Catalogue', html:
          '<p><b>📖 Catalogue</b> is the full DFL product catalogue, for checking a product, its size and pack.</p>' },
        { h: 'Store audits of your stores', html:
          '<p>When your team leader audits one of your stores, the scores appear on your Home screen under <b>📋 Store audits of your stores</b>. Tap one to read their notes and see what to fix.</p>' },
        { h: 'Getting help', html:
          '<p>Ask your team leader first. For sign-in and account problems, ask an admin. The <b>Merch Field Guide</b> at dflhq.com/training has more detail.</p>' }
      ],
      quiz: [
        { q: 'Where do you check where a product belongs on the shelf?', options: ['Planograms', 'Delivery Reports', 'My Stores'], answer: 0 },
        { q: 'Where do you see your team leader\'s audit scores for your stores?', options: ['Home, under Store audits of your stores', 'Report an Issue', 'Catalogue'], answer: 0 },
        { q: 'You cannot sign in. Who should you contact?', options: ['The store manager', 'An admin (or your team leader)', 'Nobody'], answer: 1 }
      ]
    },

    'tl-dashboard': {
      title: 'Your team dashboard', icon: '👥', minutes: 6,
      intro: 'Team leaders land on a team dashboard instead of the Brand Ambassador home screen.',
      sections: [
        { h: 'What is on it', html:
          '<ul><li><b>Team stats:</b> team size, how many are qualifying, team commission and average achievement.</li>' +
          '<li><b>Your team leader incentive</b> card: stores at 80%+ and 100%+ and the incentive earned this month.</li>' +
          '<li><b>Attendance today:</b> how many of your team have logged a visit today, and who has not. Temporary relief workers are not counted, because they only work when covering.</li>' +
          '<li><b>Today\'s activity:</b> a live feed of visits across your team, including relief cover at your stores.</li>' +
          '<li>A card for each Brand Ambassador with their achievement and today\'s visit stage.</li></ul>' },
        { h: 'Viewing a Brand Ambassador\'s app', html:
          '<p>Tap anyone on your team to open their app exactly as they see it. A yellow <b>Viewing as … · read-only</b> bar appears and logging is turned off, so nothing is recorded under their name. Use it to help someone over the phone.</p>' },
        { h: 'Team leader + Brand Ambassador', html:
          '<p>If you also have your own stores, you get a <b>Your own commission</b> card and a switch to your own merchandiser screen to log your visits.</p>' }
      ],
      quiz: [
        { q: 'Where do you see who on your team has not logged a visit today?', options: ['Attendance today', 'Planograms', 'Catalogue'], answer: 0 },
        { q: 'You open a Brand Ambassador\'s app from your team list. Can you log visits for them?', options: ['Yes', 'No, it is read-only', 'Only after 5pm'], answer: 1 },
        { q: 'Why are temporary relief workers left out of the attendance count?', options: ['They only work when covering someone', 'They are not in the app', 'They are paid by the store'], answer: 0 }
      ]
    },

    'tl-audits': {
      title: 'Store audits and evaluations', icon: '📋', minutes: 7,
      intro: 'How to audit a store and review your team each quarter.',
      sections: [
        { h: 'Doing a store audit', html:
          '<ol><li>Tap <b>📋 Store Audit</b> and pick the store.</li>' +
          '<li>Rate each area from 1 to 5 stars: shelf presence, cleanliness, pricing, rotation and the rest of the checklist.</li>' +
          '<li>Add notes on what needs fixing, then submit. The scores roll up into an overall %.</li></ol>' +
          '<p>The Brand Ambassador for that store sees your scores and notes straight away on their Home screen.</p>' },
        { h: 'Win the Week and Win the Quarter', html:
          '<p>Audit scores feed the <b>🏆 Win the Week</b> and <b>🥇 Win the Quarter</b> leaderboards. Audit your stores regularly so your team is counted.</p>' },
        { h: 'Quarterly evaluations', html:
          '<p>Each quarter, every Brand Ambassador completes a self-evaluation. Open <b>📝 Quarterly Evaluation</b>, choose the team member, complete your review and sign off together.</p>' }
      ],
      quiz: [
        { q: 'How is each audit area scored?', options: ['Pass or fail', '1 to 5 stars', 'A percentage you type in'], answer: 1 },
        { q: 'When does the Brand Ambassador see your audit?', options: ['As soon as you submit it', 'At the end of the month', 'Never'], answer: 0 },
        { q: 'Who completes the first part of a quarterly evaluation?', options: ['The Brand Ambassador, with a self-evaluation', 'The store manager', 'Admin'], answer: 0 }
      ]
    },

    'tl-routes': {
      title: 'Routes and stores', icon: '🗺️', minutes: 5,
      intro: 'How to manage which stores are on whose route.',
      sections: [
        { h: 'Reassign a store', html:
          '<p>Under <b>Reassign a store</b>, search any store and move it straight onto one of your Brand Ambassadors\' routes. No request is needed.</p>' },
        { h: 'Route change requests', html:
          '<p>When a Brand Ambassador asks for a change to their route, it appears under <b>Route change requests</b>. Approve or decline it.</p>' },
        { h: 'Store correction requests', html:
          '<p>If someone logged a visit against the wrong store, they can ask for a correction. These appear under <b>Store correction requests</b> for you to approve or decline.</p>' },
        { h: 'Team stores', html:
          '<p><b>Team Stores</b> lists every store across your team with who covers it, so you can spot gaps.</p>' }
      ],
      quiz: [
        { q: 'You want to move a store onto a team member\'s route now. What do you use?', options: ['Reassign a store', 'Report an Issue', 'Request Leave'], answer: 0 },
        { q: 'A Brand Ambassador logged a visit at the wrong store. Where does their fix come to you?', options: ['Store correction requests', 'Delivery Reports', 'Catalogue'], answer: 0 },
        { q: 'Where do you see every store across your team and who covers it?', options: ['Team Stores', 'Planograms', 'Events & Training'], answer: 0 }
      ]
    },

    'tl-leave': {
      title: 'Leave and cover', icon: '🌴', minutes: 5,
      intro: 'How to approve leave and plan cover for your area.',
      sections: [
        { h: 'Approving leave', html:
          '<p>Your team\'s requests appear under <b>Leave requests</b> on your dashboard. Check the dates and who is covering, then approve or decline. HR sees approved leave automatically.</p>' },
        { h: 'Area Leave', html:
          '<p><b>🌴 Area Leave</b> shows every vacation requested in your area, with clashes flagged, so two people covering the same stores are not off at once.</p>' },
        { h: 'Upcoming leave', html:
          '<p><b>Upcoming leave</b> on your dashboard lists who on your team is off soon. Plan relief cover before the day.</p>' },
        { h: 'Your own leave', html:
          '<p>Use <b>Request Leave</b> on your dashboard, the same as your team.</p>' }
      ],
      quiz: [
        { q: 'Where do your team\'s leave requests come for approval?', options: ['Leave requests on your dashboard', 'Report an Issue', 'Stock & Prices'], answer: 0 },
        { q: 'What does Area Leave help you spot?', options: ['Clashing vacations in your area', 'Out-of-stock products', 'Late deliveries'], answer: 0 },
        { q: 'Does HR need to be emailed when you approve leave?', options: ['Yes, always', 'No, HR sees approved leave automatically', 'Only for sick leave'], answer: 1 }
      ]
    },

    'tl-days': {
      title: 'Days Worked & Payroll', icon: '🗓️', minutes: 8,
      intro: 'Track your team\'s days worked and submit relief and extra days for pay every Wednesday.',
      sections: [
        { h: 'The rules', html:
          '<ul><li>A <b>day worked</b> = at least one store visit logged that day.</li>' +
          '<li>Pay fortnights run Monday to Sunday, two weeks at a time, from Monday 2 November 2026.</li>' +
          '<li>Brand Ambassadors and permanent relief are owed <b>10 paid weekdays</b> a fortnight. Only days over that are <b>extra</b>.</li>' +
          '<li>Public holidays and approved leave count toward the 10. Swapping a weekday for a Saturday is <b>not</b> extra; working a public holiday is.</li>' +
          '<li>Temporary relief are paid a day rate for <b>every</b> day they work.</li></ul>' },
        { h: 'Reading the screen', html:
          '<p>Open <b>🗓️ Days Worked &amp; Payroll</b>. Each person has a row of day boxes: green = worked, amber = weekend or holiday worked, pale red = no visit logged, purple = leave, grey = public holiday, dashed = assumed worked. "8/10 worked" means 8 of 10 owed; an amber <b>+1 extra</b> badge means they are over.</p>' },
        { h: 'Submitting on Wednesday', html:
          '<ol><li>In <b>Submit relief &amp; extra days</b>, check the week says <b>This week</b>.</li>' +
          '<li>Tap days on or off for each person. Greyed-out days are already submitted.</li>' +
          '<li>Pick a reason for temporary relief, check the rate per day, add a note if needed.</li>' +
          '<li>Check the total and tap <b>Submit</b>. The days go straight into Relief Coverage for the next pay run.</li></ol>' +
          '<p>Made a mistake? Change it and tap <b>Resubmit</b> before admin pays it. The full <b>Days Worked &amp; Payroll guide</b> is under How-to guides.</p>' }
      ],
      quiz: [
        { q: 'A Brand Ambassador took Wednesday off and worked Saturday. How many extra days?', options: ['1', '0', '2'], answer: 1 },
        { q: 'A fortnight has a public holiday. How many days is a Brand Ambassador owed?', options: ['10', '9', '11'], answer: 1 },
        { q: 'When do you submit relief and extra days?', options: ['Every Wednesday', 'Once a month', 'Only when asked'], answer: 0 }
      ]
    }
  }
};
