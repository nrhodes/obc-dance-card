// The manual's text. Screenshots live in shots/ and are captured from the emulator demo data.
export const VERSION_DATE = 'November 2026';
const ui = (s) => `<span class="ui">${s}</span>`;
const g = (letter, bg, fg = '#10241a') => `<kbd class="g" style="background:${bg};color:${fg}">${letter}</kbd>`;

export function content({ phones, wide, dialogs, tip, note, warn }) {
  return `
<section class="cover">
  <div class="band">
    <div class="club">Orewa Bridge Club</div>
    <h1 class="notoc">Dance Card<br>User Manual</h1>
    <div class="sub">For members, partner stewards and administrators</div>
  </div>
  <div class="hero">
    <div><img src="shots/mycard.png" alt=""></div><div><img src="shots/session-open.png" alt=""></div><div><img src="shots/calendar-month-feb.png" alt=""></div>
  </div>
  <div class="meta"><span>Web app: obc-dance-card.web.app</span><span>${VERSION_DATE}</span></div>
</section>

<h1 class="notoc" style="break-before:auto">Contents</h1>
<div class="toc"><!--TOC--></div>

<!-- ================================================================== -->
<h1>Overview</h1>
<p class="lead">The Dance Card is the club's electronic alternative to the printed programme booklet and the
names pencilled on its dotted lines. It shows the year's programme, lets you arrange a partner for any session,
and keeps everyone informed when plans change.</p>
<p>It does one job: <strong>scheduling</strong>. Scores, results and standings stay in the club's scoring
software. It is a closed system for club members only; nobody can sign themselves up.</p>

<h2>The important features</h2>
<div class="tiles">
  <div class="tile"><h3>The programme, always current</h3><p>Every weekday's series and one-off sessions for this year and next, with start times, formats and who the partner steward is.</p></div>
  <div class="tile"><h3>Invite a partner</h3><p>Ask any member to play one session or a whole series. They accept or decline with one tap, and both dance cards update together.</p></div>
  <div class="tile"><h3>The noticeboard</h3><p>No partner yet? List yourself as <em>Looking for a partner</em> (first to claim plays with you) or <em>Available</em> (others send you an invite).</p></div>
  <div class="tile"><h3>My card</h3><p>Your own dance card: every session you are down to play, who with, and anything still unresolved.</p></div>
  <div class="tile"><h3>Calendar</h3><p>A list, month or whole-year view showing at a glance where you are booked, still seeking, free or unavailable.</p></div>
  <div class="tile"><h3>Visitors and substitutes</h3><p>Play with someone who isn't a member, or record a stand-in for one week of a series, without losing the regular pairing.</p></div>
  <div class="tile"><h3>Teams events</h3><p>A captain starts a team and invites four to six players for the whole series; absences and one-night substitutes are handled per session.</p></div>
  <div class="tile"><h3>Notifications</h3><p>In the app, by email, and optionally as push notifications on your phone: invites, replies, cancellations and reminders before you play.</p></div>
  <div class="tile"><h3>Members directory</h3><p>Name, grade, phone and email of every active member, so you can still pick up the phone.</p></div>
  <div class="tile"><h3>Simple, safe sign-in</h3><p>Type your email and enter the 6-digit code we send you. No password is needed, though you may set one. You stay signed in on your own device.</p></div>
</div>

<h2>Who does what</h2>
<div class="roles">
  <div class="tile"><h3>Members</h3><p>Everyone. Browse the programme, arrange partners, manage your own card, visitors and notification preferences.</p></div>
  <div class="tile"><h3>Partner stewards</h3><p>One named member per weekday who helps people find partners. Shown on the Programme screen. Uses the same screens as any member.</p></div>
  <div class="tile"><h3>Administrators</h3><p>Maintain the member list and the programme, act on a member's behalf when asked, send club-wide messages and review the audit log.</p></div>
</div>

<h2>How it fits together</h2>
<ol class="steps">
  <li>Each year an administrator loads the programme and publishes it. Every member is told it is out.</li>
  <li>Members open a session and either invite a partner, list themselves on the noticeboard, or sign up with a visitor.</li>
  <li>When a partner accepts (or claims a listing), the pairing appears on both dance cards and in that session's <em>Who's playing</em> list.</li>
  <li>If someone has to cancel, their partner is told at once and is automatically listed as looking for a partner again.</li>
  <li>A reminder goes out before each session (two days ahead unless you change it).</li>
  <li>Once a session's start time arrives it is locked and can no longer be changed.</li>
</ol>

<h2>Where to find it</h2>
<p>Open <strong>https://obc-dance-card.web.app</strong> in the web browser of any computer, tablet or phone. You can add it to your home screen so it behaves like an app (see <em>Getting started</em>).</p>
${note(`<p>The pictures in this manual were taken from the web version using made-up members and dates.</p>`)}

<!-- ================================================================== -->
<h1><span class="part">Part 1 · Members</span>Getting started</h1>

<h2>Signing in</h2>
<p>Your account already exists: the club created it from the membership list, using the email address the club holds for you. There is nothing to register.</p>
<ol class="steps">
  <li>Open the app and type your <strong>email address</strong>, then choose ${ui('Email me a code')}.</li>
  <li>Check your email. A message from the club contains a <strong>6-digit code</strong>, valid for 10 minutes.</li>
  <li>Type the code and choose ${ui('Sign in')}. You arrive at your dance card.</li>
</ol>
${phones(
  ['signin-email', 'Enter the email address the club has for you.'],
  ['signin-code', 'Enter the 6-digit code from your email.'],
  ['signin-password', 'If you have set a password, choose “I have a password”.'],
)}
<ul>
  <li><strong>No email arrived?</strong> Look in your junk or spam folder. After a minute you can choose ${ui('Send a new code')}. Only the newest code works.</li>
  <li><strong>The app says nothing useful about a wrong address.</strong> That is deliberate, for privacy. If no code arrives, the address is probably not the one on the club's list; ask an administrator to check it.</li>
  <li><strong>Too many attempts.</strong> Codes can be requested three times in 15 minutes. Wait a quarter of an hour and try again.</li>
  <li><strong>You stay signed in</strong> on that device until you sign out, so you will rarely need a code again.</li>
</ul>

<h2>Using a password instead (optional)</h2>
<p>If you would rather not wait for an email, set a password in ${ui('Profile')} (at least 8 characters). Next time, choose ${ui('I have a password')} on the sign-in screen. If you forget it, simply sign in with an emailed code and set a new one. A password can be removed again from the same place.</p>

<h2>Finding your way around</h2>
<div class="cols"><div>
<p>The dark bar at the top is on every screen.</p>
<table>
  <tr><th style="width:32%">Item</th><th>What it shows</th></tr>
  <tr><td>${ui('My card')}</td><td>Your own dance card: everything you are down to play.</td></tr>
  <tr><td>${ui('Programme')}</td><td>The club programme by weekday. The way in to every session.</td></tr>
  <tr><td>${ui('Calendar')}</td><td>Your year at a glance, and bulk availability.</td></tr>
  <tr><td>${ui('Invites')}</td><td>Invitations waiting for you, and ones you have sent. A red number means some are waiting.</td></tr>
  <tr><td>${ui('Notifications')}</td><td>Everything the app has told you. A red number counts unread items.</td></tr>
  <tr><td>${ui('Members')}</td><td>The members directory.</td></tr>
  <tr><td>${ui('More')}</td><td>Profile, Help and Sign out.</td></tr>
  <tr><td>${ui('Admin')}</td><td>Administrators only.</td></tr>
</table>
</div>
${phones(['nav-more', 'The navigation bar. Red badges show invites and unread notifications.'])}
</div>

<h2>Putting it on your phone or tablet</h2>
<ul>
  <li><strong>iPhone or iPad:</strong> open the site in Safari, tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.</li>
  <li><strong>Android:</strong> open the site in Chrome and accept the offer to <strong>Install app</strong>, or choose it from the three-dot menu.</li>
</ul>
<p>An icon then appears on your home screen like any other app. The same instructions are inside the app under ${ui('More')} → ${ui('Help')}.</p>

<!-- ================================================================== -->
<h1><span class="part">Part 1 · Members</span>The programme and sessions</h1>

<h2>Browsing the programme</h2>
<div class="cols"><div>
<p>${ui('Programme')} shows this year and next year together. Choose a weekday tab (Mon to Fri).</p>
<ul>
  <li>The first card gives the weekday's <strong>start time</strong>, the time to be <strong>seated by</strong>, and the <strong>partner steward</strong> with their phone number.</li>
  <li>Each <strong>series</strong> has its own card listing its dates. Tap a date to open that session.</li>
  <li><strong>One-off sessions</strong>, such as Holiday Bridge, appear between the series in date order.</li>
  <li>Past sessions are hidden. Choose ${ui('Show earlier sessions')} to see them, or ${ui('Jump to today')} to return.</li>
</ul>
<h3>The small labels on a series</h3>
<table>
  <tr><th style="width:36%">Label</th><th>Meaning</th></tr>
  <tr><td>SCR / HCP</td><td>Scratch or handicap scoring.</td></tr>
  <tr><td>PAIRS</td><td>You enter with one partner.</td></tr>
  <tr><td>INDIVIDUAL</td><td>You arrange a partner week by week; the app warns you if you repeat one.</td></tr>
  <tr><td>TEAMS</td><td>Entered by teams of four to six (see <em>Teams events</em>).</td></tr>
  <tr><td>BEST 5 OF 6</td><td>Your best five results from six sessions count.</td></tr>
  <tr><td>NO SUBSTITUTES</td><td>A stand-in cannot be recorded for this series.</td></tr>
</table>
<p>Any eligibility note (for example “Max 1 open player”) is shown for information. The app does not enforce it.</p>
</div>
${phones(['programme', 'The Programme screen, Monday tab.', 150])}
</div>

<h2>A session page</h2>
<p>Everything you do for one date happens on that session's page. It has three parts.</p>
<div class="cols"><div>
<ul>
  <li><strong>Header:</strong> the series or session name, date, times and labels. If you are already involved, a green line states your position, such as “You: confirmed with Karen Wright”.</li>
  <li><strong>Who's playing:</strong> confirmed pairs first, then the noticeboard: members <em>Looking for a partner</em> and members who are <em>Available</em>. A visitor is shown as “(visitor)”.</li>
  <li><strong>Actions:</strong> the buttons for what you can do next. They change with your situation.</li>
</ul>
<table>
  <tr><th style="width:44%">If you have nothing arranged</th><th>What the button does</th></tr>
  <tr><td>${ui('Invite a partner')}</td><td>Ask a particular member.</td></tr>
  <tr><td>${ui("I'm looking for a partner")}</td><td>List yourself; first to claim plays with you.</td></tr>
  <tr><td>${ui("I'm available")}</td><td>A softer listing; others invite you.</td></tr>
  <tr><td>${ui('Play with a visitor')}</td><td>Sign up with a non-member.</td></tr>
  <tr><td>${ui("I'm unavailable")}</td><td>Stop others inviting you to this session.</td></tr>
</table>
${note(`<p>A session is <strong>locked at its start time</strong>. After that the page says “This session has started” and nothing can be changed. A date marked <em>No Bridge</em> has no page to act on.</p>`)}
</div>
${phones(['session-open', 'A session page before you have arranged anything.', 170])}
</div>

<!-- ================================================================== -->
<h1><span class="part">Part 1 · Members</span>Finding a partner</h1>
<p class="lead">There are three ways to get a partner: invite someone, use the noticeboard, or bring a visitor.</p>

<h2>Inviting a member</h2>
<ol class="steps">
  <li>Open the session and choose ${ui('Invite a partner')}.</li>
  <li>Start typing a name and tap the member you want. Members already playing in that session are not offered.</li>
  <li>Add a short message if you wish.</li>
  <li>For a series, tick ${ui('Invite for the whole series')} to ask them for every date in one go. Leave it unticked to ask for this date only.</li>
  <li>Choose ${ui('Send invite')}.</li>
</ol>
${phones(
  ['invite-search', 'Type part of a name to find a member.'],
  ['invite-confirm', 'Add a message and choose one session or the whole series.'],
  ['session-waiting', 'While you wait, the session shows who you have asked.'],
)}
<p>Your partner is notified straight away. Until they answer, the session page shows <strong>Waiting for a reply</strong>, with ${ui('Cancel invitation')} if you change your mind. Nothing appears on either dance card until they accept.</p>
<ul>
  <li>An invite <strong>expires after 7 days</strong> if it is not answered, and you are told.</li>
  <li>For a whole-series invite, accepting pairs you for every date at once. If either of you already has something arranged on one of those dates, the accept is refused and the clashing dates are listed, so nothing is half done.</li>
</ul>

<h2>Answering an invitation</h2>
<div class="cols"><div>
<p>A red number beside ${ui('Invites')} means someone is waiting for your answer. You will also have had a notification and, unless you turned it off, an email.</p>
<ol class="steps">
  <li>Open ${ui('Invites')}. Each incoming invite shows who asked, the dates, any message, and when it expires.</li>
  <li>Choose ${ui('Accept')} or ${ui('Decline')}. The sender is told either way.</li>
</ol>
<p>The same Accept and Decline buttons appear on the session page itself under <strong>You've been invited</strong>.</p>
<p>The Invites screen also lists:</p>
<ul>
  <li><strong>Sent:</strong> your own invites still awaiting an answer, each with ${ui('Withdraw')}.</li>
  <li><strong>Recently resolved:</strong> the last few that were accepted, declined, withdrawn or expired.</li>
</ul>
</div>
${phones(['invites', 'Invites: one incoming, one sent.', 140])}
</div>

<h2>The noticeboard: “Looking for a partner” and “Available”</h2>
<p>If you have nobody in mind, put yourself on the session's noticeboard. There are two kinds of listing, and the difference matters.</p>
<table>
  <tr><th style="width:24%">Listing</th><th style="width:38%">What happens</th><th>Use it when</th></tr>
  <tr><td><strong>Looking for a partner</strong></td><td>The first member to tap ${ui('Play with …')} beside your name is paired with you <strong>immediately</strong>. You are told, and you can cancel if it doesn't suit.</td><td>You definitely want to play and are happy with whoever comes first.</td></tr>
  <tr><td><strong>Available</strong></td><td>Others see ${ui('Invite …')} beside your name. They send an ordinary invite, which you accept or decline.</td><td>You would like to play but want to choose.</td></tr>
</table>
<ol class="steps">
  <li>Open the session and choose ${ui("I'm looking for a partner")} or ${ui("I'm available")}.</li>
  <li>Add a note if it helps, such as the system you play, and choose ${ui('Confirm')}.</li>
</ol>
<p>Your name now appears in that section of <em>Who's playing</em>. On your own view the Actions change to ${ui('Switch to available')} (or back) and ${ui('Remove')}.</p>
${phones(
  ['lfp-dialog', 'Listing yourself, with an optional note.', 100],
  ['claim-confirm', 'Claiming someone else’s listing asks you to confirm.', 100],
  ['session-confirmed', 'Paired. The green lines confirm it and the Actions change.', 100],
)}
<h3>Taking up someone else's listing</h3>
<ul>
  <li>Beside a member who is <em>Looking for a partner</em>, tap ${ui('Play with [name]')} and confirm. You are paired at once.</li>
  <li>Beside a member who is <em>Available</em>, tap ${ui('Invite [name]')}. This sends an invite for them to answer.</li>
</ul>
${tip(`<p>Turn on <strong>“Tell me when someone is looking for a partner”</strong> in Profile to be notified whenever a member lists themselves for a session on which you are free.</p>`)}

<h2>Playing with a visitor</h2>
<div class="cols"><div>
<p>A visitor is someone who is not a club member. They have no account and never sign in; you sponsor them.</p>
<ol class="steps">
  <li>Open the session and choose ${ui('Play with a visitor')}.</li>
  <li>Pick one of your existing visitors, or fill in a new one. Only the <strong>name</strong> is required.</li>
  <li>Tick ${ui('For the whole series')} if they are playing every date.</li>
  <li>Choose ${ui('Add and continue')}. You are signed up straight away; a visitor has nothing to accept.</li>
</ol>
<ul>
  <li>Other members see only the visitor's name, shown as “Peter Wilson &amp; Graham Lowe (visitor)”. Their email and phone are visible only to you and to administrators.</li>
  <li>If you give an email address and tick ${ui('Send them a confirmation email')}, the visitor receives a plain courtesy email when you sign up and if you cancel. They receive nothing else.</li>
  <li>To change a visitor partner, cancel the session and sign up again.</li>
  <li>Manage your list under ${ui('Profile')} → ${ui('Manage my visitors')}. You may have up to 20 visitors in a programme year. A visitor with upcoming sessions cannot be deleted until those are cancelled.</li>
</ul>
</div>
${phones(['visitor-dialog', 'Signing up with a new visitor.', 118])}
</div>

<h2>Marking yourself unavailable</h2>
<p>${ui("I'm unavailable")} tells the app not to show you as free for that session and stops other members inviting you to it. It is not a booking and you can undo it at any time. To mark many dates at once, such as “I never play Tuesdays”, use ${ui('Set availability')} on the Calendar screen.</p>

<!-- ================================================================== -->
<h1><span class="part">Part 1 · Members</span>Changing your plans</h1>

<h2>Cancelling a session</h2>
<div class="cols"><div>
<ol class="steps">
  <li>Open the session from ${ui('My card')} or ${ui('Programme')}.</li>
  <li>Choose ${ui('Cancel this session')}. The app explains exactly what will happen.</li>
  <li>Confirm.</li>
</ol>
<p>What cancelling does:</p>
<ul>
  <li>Your entry for <strong>that date only</strong> is cancelled. Other dates in the series are untouched.</li>
  <li>Your partner is notified immediately and is <strong>automatically listed as looking for a partner</strong>, so someone else can pick them up.</li>
  <li>If your partner was a visitor, only your own entry is removed (and the visitor gets a courtesy email if they opted in).</li>
</ul>
${warn(`<p>Please cancel as early as you can. Your partner depends on the notice to find someone else, and nothing can be changed once the session has started.</p>`)}
</div>
${phones(['cancel-confirm', 'The app spells out the consequence before you confirm.', 118])}
</div>

<h2>Arranging a substitute for one week</h2>
<p>In a series you register once as a pair. If one of you cannot make a particular week, record a stand-in for that date instead of cancelling; your regular pairing stays in place for the other weeks.</p>
<ol class="steps">
  <li>Open the session and choose ${ui('Arrange a substitute')}.</li>
  <li>Say who is missing: ${ui("I can't come")} or ${ui("[Partner] can't come")}.</li>
  <li>Choose who will stand in: search for a member, or use ${ui('Add a new visitor')}.</li>
</ol>
${phones(
  ['substitute-1', 'First say which of you is away.', 100],
  ['substitute-2', 'Then choose the stand-in.', 100],
)}
<ul>
  <li>Everyone involved is notified.</li>
  <li>${ui('Remove substitute')} restores the original pairing for that date.</li>
  <li>A series labelled <strong>NO SUBSTITUTES</strong> does not offer this. The session page says so.</li>
  <li>A pairing with a visitor cannot have a substitute; cancel and sign up again instead.</li>
</ul>

<!-- ================================================================== -->
<h1><span class="part">Part 1 · Members</span>My card and the calendar</h1>

<h2>My card</h2>
<div class="cols"><div>
<p>${ui('My card')} is the first screen after signing in. It lists everything ahead of you, grouped by weekday and then by series.</p>
<ul>
  <li>Each line gives the date and your position: <em>with Karen Wright</em>, <em>looking for a partner</em>, <em>available</em>, a team name, and so on.</li>
  <li>Tap any line to open that session.</li>
  <li>Team sessions carry a <strong>TEAM</strong> badge.</li>
  <li>${ui('Show past')} reveals your ten most recent past sessions.</li>
</ul>
<p>If the card is empty it says so and points you to the Programme.</p>
</div>
${phones(['mycard', 'My card, grouped by weekday and series.', 120])}
</div>

<h2>The calendar</h2>
<p>${ui('Calendar')} shows the same information by date, in three layouts chosen with the tabs.</p>
<table>
  <tr><th style="width:18%">Tab</th><th>What you see</th></tr>
  <tr><td><strong>List</strong></td><td>The next fortnight of sessions, one line each with its status. ${ui('Show more')} adds another fortnight.</td></tr>
  <tr><td><strong>Month</strong></td><td>A Monday-to-Friday grid for one month, with ${ui('Prev')} and ${ui('Next')}. Sessions in the same series are joined by a line down the column, and the series are named underneath.</td></tr>
  <tr><td><strong>Year</strong></td><td>Every month of the chosen year on one page.</td></tr>
</table>
<p>Tap a coloured day to open its session. The colours and letters mean:</p>
<table>
  <tr><th style="width:9%">Key</th><th style="width:27%">Status</th><th>Meaning</th></tr>
  <tr><td>${g('B', '#52b788')}</td><td>Booked</td><td>You have a confirmed partner or team.</td></tr>
  <tr><td>${g('P', '#d8f3dc')}</td><td>Partly booked</td><td>More than one session that day and you are booked for some of them.</td></tr>
  <tr><td>${g('S', '#b197fc', '#1b1140')}</td><td>Seeking a partner</td><td>You are on the noticeboard (looking or available) but not yet paired.</td></tr>
  <tr><td>${g('O', '#ff9838', '#3a1c00')}</td><td>Open</td><td>There is a session and you have nothing arranged: you could book.</td></tr>
  <tr><td>${g('U', '#3a3d45', '#fff')}</td><td>Unavailable</td><td>You have marked yourself unavailable.</td></tr>
</table>
${phones(
  ['calendar-month-feb', 'Month view.', 130],
  ['calendar-year', 'Year view (top of the page).', 130],
  ['availability-dialog', 'Set availability for many dates at once.', 130],
)}

<h2>Setting availability in bulk</h2>
<ol class="steps">
  <li>On the Calendar screen choose ${ui('Set availability…')}.</li>
  <li>Choose a status: <strong>Available</strong> (show me as free; anyone can invite me), <strong>Unavailable</strong> (don't show me as free and don't let others invite me) or <strong>Clear</strong> (remove any listing or marker).</li>
  <li>Tick one or more weekdays and set the <strong>From</strong> and <strong>To</strong> dates.</li>
  <li>Check the preview line, for example “This will mark about 9 sessions as unavailable”, then choose ${ui('Confirm')}.</li>
</ol>
<p>Sessions where you already have a confirmed booking are left alone.</p>

<h2>Showing your sessions in your own calendar</h2>
<p>Under ${ui('Profile')} → <strong>Calendar feed</strong>, choose ${ui('Create calendar link')}. You can then:</p>
<ul>
  <li>tap ${ui('Open in Apple Calendar')} on an iPhone, iPad or Mac; or</li>
  <li>for Google Calendar, use ${ui('Copy link')}, then on a computer open calendar.google.com, click <strong>+</strong> beside <em>Other calendars</em>, choose <strong>From URL</strong> and paste the link.</li>
</ul>
<p>Your bridge sessions then appear alongside your other appointments and update by themselves.</p>
${warn(`<p>Anyone who has the link can see your bridge schedule, so treat it like a password. ${ui('Reset link')} replaces it with a new one and ${ui('Remove link')} turns the feed off.</p>`)}

<!-- ================================================================== -->
<h1><span class="part">Part 1 · Members</span>Teams and Individual events</h1>

<h2>Teams events</h2>
<p>A series labelled <strong>TEAMS</strong> is entered by teams, not pairs. A team has a captain and four to six players, who join for the <strong>whole series</strong>. Who partners whom on the night is sorted out at the table, not in the app.</p>

<h3>If you are the captain</h3>
<ol class="steps">
  <li>Open any session in the series and choose ${ui('Start a team')}. Give it a name or accept the suggestion (your surname).</li>
  <li>Choose ${ui('Invite a member')} for each player. They receive a team invite covering every date.</li>
  <li>Use ${ui('Add a visitor')} for a non-member player.</li>
  <li>The team shows as <strong>Forming</strong> until it reaches the minimum (normally four), then <strong>Active</strong>.</li>
</ol>
${phones(
  ['team-before', 'A teams session before any team exists.', 130],
  ['team-captain', 'The captain’s view of the team.', 130],
  ['team-invite', 'A team invite in a member’s Invites.', 130],
)}
<table>
  <tr><th style="width:38%">Captain's button</th><th>What it does</th></tr>
  <tr><td>${ui('Remove')} (beside a name)</td><td>Takes that player off the team and cancels their sessions in the series.</td></tr>
  <tr><td>${ui('Add a substitute for this session')}</td><td>Available when a team member has cancelled this one date. Records a stand-in for that date only.</td></tr>
  <tr><td>${ui('Transfer captaincy')}</td><td>Offers the captaincy to another team member, who must accept.</td></tr>
  <tr><td>${ui('Disband team')}</td><td>Closes the team and cancels every member's sessions in the series. This cannot be undone.</td></tr>
  <tr><td>${ui('Add [name] to my team')}</td><td>Shown beside anyone <em>Looking for a team</em>, while your team has space. Adds them at once.</td></tr>
</table>

<h3>If you are a team member</h3>
<ul>
  <li>A team invite arrives in ${ui('Invites')} labelled “Team invite from [captain] — [team] ([series])”. Accepting puts every date of the series on your card with a TEAM badge.</li>
  <li><strong>Missing one week:</strong> open that date and cancel as usual. Only that date is affected, and the captain is told so they can add a substitute.</li>
  <li><strong>Leaving altogether:</strong> choose ${ui('Leave team')}. Your remaining sessions in the series are cancelled and the captain is told.</li>
  <li>You can be in only one team per series.</li>
</ul>

<h3>If you have no team</h3>
<p>Choose ${ui("I'm looking for a team")} or ${ui("I'm available for a team")}. These work like the pairs noticeboard, except that only a captain with space can take you up, and it applies to the whole series.</p>

<h2>Individual events</h2>
<p>In a series labelled <strong>INDIVIDUAL</strong> you arrange a different partner each week, one date at a time, using the same invite and noticeboard steps. If you accept someone you have already played with in that series, the app tells you so. It is a reminder only; it does not stop you.</p>

<!-- ================================================================== -->
<h1><span class="part">Part 1 · Members</span>Notifications, directory and profile</h1>

<h2>Notifications</h2>
<div class="cols"><div>
<p>${ui('Notifications')} keeps the last 50 things the app has told you, newest first. Tap one to mark it read and jump to the session or invite it concerns. ${ui('Mark all read')} clears the red number.</p>
<p>You are notified when:</p>
<ul>
  <li>you receive an invite, or yours is accepted, declined, withdrawn or expires;</li>
  <li>someone claims your <em>Looking for a partner</em> listing;</li>
  <li>your partner cancels, or a substitute is arranged or removed;</li>
  <li>a session you are booked for is coming up (the reminder);</li>
  <li>someone joins, leaves, is absent from or disbands your team, or offers you the captaincy;</li>
  <li>the programme is published or a session you are in is changed;</li>
  <li>an administrator sends a club message, or does something on your behalf.</li>
</ul>
</div>
${phones(['notifications-karen', 'The Notifications screen.', 112])}
</div>
<h3>How they reach you</h3>
<table>
  <tr><th style="width:22%">Channel</th><th>Details</th></tr>
  <tr><td>In the app</td><td>Always. The red numbers in the navigation bar.</td></tr>
  <tr><td>Email</td><td>On by default. Either each one straight away, or one summary a day at 5 pm.</td></tr>
  <tr><td>Push</td><td>A pop-up on your phone or computer. You switch it on for each device.</td></tr>
</table>

<h2>Notification preferences</h2>
<div class="cols"><div>
<p>Open ${ui('More')} → ${ui('Profile')} and find <strong>Notifications</strong>.</p>
<table>
  <tr><th style="width:44%">Setting</th><th>Effect</th></tr>
  <tr><td>Push notifications</td><td>Allow push at all.</td></tr>
  <tr><td>Email notifications</td><td>Allow email at all.</td></tr>
  <tr><td>Session reminders</td><td>Remind me before I play.</td></tr>
  <tr><td>Remind me this many days before</td><td>From “On the day” to 7 days. Normally 2.</td></tr>
  <tr><td>Tell me when someone is looking for a partner</td><td>Alert me to new listings on sessions where I am free. Off unless you turn it on.</td></tr>
  <tr><td>Email frequency</td><td>“Send each one right away” or “Send one summary a day”.</td></tr>
</table>
<p>Choose ${ui('Save preferences')} after changing anything.</p>
<p>Security notices, club messages from an administrator and notices of actions taken on your behalf are always emailed immediately, whatever you choose.</p>
<h3>Push on this device</h3>
<p>Under <strong>Push notifications on this device</strong> choose ${ui('Turn on notifications on this device')} and allow it when your browser asks. Repeat on each phone, tablet or computer you use. On an iPhone or iPad the site must first be added to the home screen. If the app says notifications are blocked, allow them for the site in your browser's settings and reload.</p>
</div>
${phones(['profile-card-2', 'Notification preferences in Profile.'])}
</div>

<h2>The members directory</h2>
<div class="cols"><div>
<p>${ui('Members')} lists every active member, sorted by surname, with grade, phone number and email address. Type in <strong>Search by name</strong> to narrow the list, and tap a phone number to call it from a mobile.</p>
<p>Only signed-in, active members can see the directory. When someone leaves the club and their account is deactivated, they lose access to it at once.</p>
</div>
${phones(['members', 'The members directory.', 62])}
</div>

<h2>Your profile</h2>
<p>${ui('More')} → ${ui('Profile')} gathers everything personal to you.</p>
<table>
  <tr><th style="width:30%">Section</th><th>What you can do</th></tr>
  <tr><td>Profile</td><td>See your name, grade and email. Change your <strong>phone number</strong> and choose ${ui('Save phone number')}. Name, grade and email come from the club's membership list; ask an administrator to correct them.</td></tr>
  <tr><td>My visitors</td><td>${ui('Manage my visitors')}: add, edit or delete the non-members you sponsor.</td></tr>
  <tr><td>Notifications</td><td>The preferences described above.</td></tr>
  <tr><td>Push notifications on this device</td><td>Turn push on or off for the device in your hand.</td></tr>
  <tr><td>Calendar feed</td><td>Create, reset or remove your private calendar link.</td></tr>
  <tr><td>Password</td><td>Set, change or remove an optional password.</td></tr>
  <tr><td>Sign out</td><td>Sign out of this device. Links to Help and the Privacy statement are below it.</td></tr>
</table>

<h2>Privacy in brief</h2>
<ul>
  <li>The app stores your name, grade, phone, email, your dance card, and any visitors you add.</li>
  <li>Other active members can see your name, grade, phone and email, and who is playing in each session.</li>
  <li>A visitor's contact details are visible only to the member who added them and to administrators.</li>
  <li>Administrators can see everything in order to run the club. Anything an administrator does on your behalf is recorded, and you are notified of it.</li>
  <li>If you leave, your account is deactivated, not deleted, so other members' past cards stay correct. Your personal details can later be erased on request.</li>
</ul>
<p>The full statement is on the <strong>Privacy</strong> link at the foot of the sign-in and Profile screens.</p>

<!-- ================================================================== -->
<h1><span class="part">Part 2 · Partner stewards</span>The steward's guide</h1>
<p class="lead">Each weekday has one partner steward: the person members turn to when they cannot find a partner. This part explains how the Dance Card supports that job.</p>

<h2>What the role is, and is not</h2>
<div class="cols"><div>
<ul>
  <li>An administrator names you as steward for a weekday. Your name and phone number then appear at the top of that weekday on every member's Programme screen, and the in-app Help tells members to phone you.</li>
  <li><strong>The role carries no extra powers in the app.</strong> You see the same screens and buttons as every other member. You cannot pair two other people, cancel on someone's behalf or edit the programme.</li>
  <li>What you bring is knowledge of the members and a telephone. The app gives you the complete picture of who still needs a partner and makes it quick for those members to finish the job themselves.</li>
</ul>
${note(`<p>If a steward needs to make changes for members who do not use the app, the club can also make that person an administrator. See <em>Acting on behalf of a member</em> in Part 3.</p>`)}
</div>
${phones(['programme-steward', 'Members see the steward’s name and phone number at the top of each weekday.'])}
</div>

<h2>Setting yourself up</h2>
<ol class="steps">
  <li><strong>Check your phone number.</strong> Members see the number on your profile. Correct it under ${ui('More')} → ${ui('Profile')}.</li>
  <li><strong>Turn on listing alerts.</strong> In Profile, tick ${ui('Tell me when someone is looking for a partner')} and save. You are then notified each time a member lists themselves for a pairs or teams session on which you are not already playing.</li>
  <li><strong>Turn on push</strong> on your phone so those alerts reach you promptly, and keep email set to “Send each one right away”.</li>
  <li><strong>Add the app to your home screen</strong> so the session lists are one tap away.</li>
</ol>
${warn(`<p>Listing alerts go only to members who are free for that session. If you are booked to play that day yourself, you will not receive them, so check the session page directly.</p>`)}

<h2>Seeing who needs a partner</h2>
<div class="cols"><div>
<p>The session page is your working list.</p>
<ol class="steps">
  <li>Open ${ui('Programme')}, choose your weekday and tap the date.</li>
  <li>Read <strong>Who's playing</strong> from the top:
    <ul>
      <li>confirmed pairs (nothing to do);</li>
      <li><strong>Looking for a partner</strong>: members who want to play and will take the first offer;</li>
      <li><strong>Available</strong>: members willing to play who want to be asked.</li>
    </ul>
  </li>
  <li>Any note a member added, such as the system they play, is shown beside their name.</li>
</ol>
<p>Two members under <em>Looking for a partner</em> are an easy match: ring one and suggest they tap ${ui('Play with …')} beside the other. An odd one out can be matched with someone under <em>Available</em>, or with a member who has not signed up at all.</p>
<p>The list updates by itself while the page is open.</p>
</div>
${phones(['session-s30', 'Two members looking, one pair confirmed.', 98])}
</div>

<h2>Making the match</h2>
<p>Because you cannot pair other people yourself, a match is completed by one of the two members. Tell them which of these to do:</p>
<table>
  <tr><th style="width:38%">Situation</th><th>What to ask the member to do</th></tr>
  <tr><td>The other person is listed as <em>Looking for a partner</em></td><td>Open the session and tap ${ui('Play with [name]')}. Done immediately.</td></tr>
  <tr><td>The other person is listed as <em>Available</em></td><td>Tap ${ui('Invite [name]')}; the other person then accepts under Invites.</td></tr>
  <tr><td>Neither is listed</td><td>One opens the session, chooses ${ui('Invite a partner')} and picks the other, who accepts.</td></tr>
  <tr><td>One of them does not use the app</td><td>Ask an administrator to act on that member's behalf (Part 3). The member is notified of what was done.</td></tr>
  <tr><td>The partner will be a non-member</td><td>The member chooses ${ui('Play with a visitor')} and enters the visitor's name.</td></tr>
  <tr><td>You are going to play with them yourself</td><td>Use the buttons yourself, exactly as any member would.</td></tr>
</table>
<p>Use ${ui('Members')} to look up phone numbers and email addresses.</p>

<h2>A steward's routine</h2>
<table>
  <tr><th style="width:26%">When</th><th>What to check</th></tr>
  <tr><td>A week ahead</td><td>Open the coming session. Note who is on the noticeboard and which regulars are missing altogether.</td></tr>
  <tr><td>Two days ahead</td><td>Members receive their reminders around now, which prompts cancellations. Look again, and act on any new listing alerts.</td></tr>
  <tr><td>The day before</td><td>Ring anyone still under <em>Looking for a partner</em> or <em>Available</em>. Pair the odd ones.</td></tr>
  <tr><td>On the day</td><td>A last look before the start time. After the start time the session is locked; late changes are handled at the table.</td></tr>
</table>
${tip(`<p>When a member cancels, their partner is automatically put under <em>Looking for a partner</em> and, if you have listing alerts on and are free that day, you hear about it. That is usually your cue to pick up the phone.</p>`)}

<h2>Teams events</h2>
<p>For a TEAMS series the noticeboard reads <em>Looking for a team</em> and <em>Available for a team</em>, and the session page lists each team with its captain and whether it is still <strong>forming</strong> (below the minimum size). Only a captain with space can take a listed member, so the steward's job is to put the member in touch with a captain whose team is short.</p>

<h2>Handing over</h2>
<p>When the stewardship changes, ask an administrator to change the steward for that weekday (Admin → Programme → Weekdays → Edit). The new name and number show to members straight away. Nothing else needs transferring, because a steward holds no records of their own in the app.</p>

<!-- ================================================================== -->
<h1><span class="part">Part 3 · Administrators</span>Administration basics</h1>
<p class="lead">Administrators keep the member list and the programme correct, help members who cannot help themselves, and keep an eye on the system's health. All administrator screens are in the web app.</p>

<h2>The Admin menu</h2>
<p>Administrators see an extra ${ui('Admin')} item at the right of the navigation bar. It opens five screens.</p>
${wide('admin-nav', 'The Admin menu, visible only to administrators.', 44)}
<table>
  <tr><th style="width:20%">Screen</th><th>Purpose</th></tr>
  <tr><td>${ui('Members')}</td><td>Every member, active or not: roles, deactivation, acting on behalf, and the membership import.</td></tr>
  <tr><td>${ui('Programme')}</td><td>Import and publish a year's programme; edit weekdays, series and sessions; see sign-up counts.</td></tr>
  <tr><td>${ui('Broadcast')}</td><td>Send a message to all members, or to those playing on a given weekday.</td></tr>
  <tr><td>${ui('Audit log')}</td><td>A record of every administrator action.</td></tr>
  <tr><td>${ui('Integrity')}</td><td>Check that all pairings and teams are consistent, and repair them if not.</td></tr>
</table>
<p>An administrator is also an ordinary member, with their own dance card and the same member screens.</p>

<h2>Ground rules</h2>
<ul>
  <li><strong>Everything you do as an administrator is recorded</strong> in the audit log with your name and the time.</li>
  <li><strong>Members are told</strong> whenever you act on their behalf.</li>
  <li><strong>There must always be at least one administrator.</strong> The app refuses to remove or deactivate the last one. The club should keep at least two.</li>
  <li><strong>Administrators can see every member's details</strong>, including visitors' contact details. Use that access only for club business.</li>
</ul>

<!-- ================================================================== -->
<h1><span class="part">Part 3 · Administrators</span>Managing members</h1>

<h2>The members table</h2>
<p>${ui('Admin')} → ${ui('Members')} lists every member with grade, phone, role, whether they are active, and when they last appeared in an import. Search by name, or filter by status (All, Active, Inactive) and role (All, Admins only).</p>
${wide('admin-members', 'The administrator’s members table. Each row carries its own action links.', 125, true)}
<table>
  <tr><th style="width:22%">Button</th><th>What it does</th></tr>
  <tr><td>${ui('Make admin')} / ${ui('Remove admin')}</td><td>Gives or removes administrator rights. Asks for confirmation. The last administrator cannot be removed.</td></tr>
  <tr><td>${ui('Deactivate')}</td><td>For a member who has left. See below.</td></tr>
  <tr><td>${ui('Reactivate')}</td><td>Shown for inactive members. Restores sign-in. Earlier bookings are not restored.</td></tr>
  <tr><td>${ui('Erase')}</td><td>Shown for inactive members. Permanently removes personal details. See below.</td></tr>
  <tr><td>${ui('Act on behalf')}</td><td>Use the app as that member. See the next chapter.</td></tr>
</table>

<h2>Deactivating a member</h2>
<div class="cols"><div>
<p>Use this when someone resigns or should no longer have access. Choose ${ui('Deactivate')}, give a reason if you wish, and confirm. The member:</p>
<ul>
  <li>is signed out everywhere and can no longer sign in;</li>
  <li>has all future pairings cancelled, with partners notified and re-listed as looking for a partner;</li>
  <li>has pending invites expired;</li>
  <li>is removed from any team. If they were captain, the captaincy passes to the longest-standing remaining member, or the team is disbanded if nobody is left.</li>
</ul>
<p>Their past sessions remain, so other members' history stays correct. Find deactivated members by setting <strong>Status</strong> to <em>Inactive</em>.</p>
</div>
${dialogs(['admin-deactivate', 'Deactivating a member.', 78])}
</div>

<h2>Erasing a member's personal details</h2>
<div class="cols"><div>
<p>Erasing is for privacy requests and is <strong>permanent</strong>. It scrubs the member's name, phone and email, deletes their visitors, and removes their sign-in account. Their past entries are kept in anonymised form.</p>
<ul>
  <li>The member must have been deactivated for <strong>at least 30 days</strong>.</li>
  <li>You must type the member's full name to confirm.</li>
</ul>
</div>
${dialogs(['admin-erase', 'Erasing requires typing the member’s full name.', 78])}
</div>

<h2>Importing the membership list</h2>
<p>Members are never added one at a time. The member list is kept in step with the club's membership records by importing a CSV file (a spreadsheet saved as “comma-separated values”). Do this whenever members join or leave, or details change.</p>
<h3>The file</h3>
<p>One row per member, with exactly these column headings. A template can be downloaded from the import screen.</p>
<table>
  <tr><th style="width:20%">Column</th><th>Notes</th></tr>
  <tr><td><code>firstName</code></td><td>Required.</td></tr>
  <tr><td><code>lastName</code></td><td>Required.</td></tr>
  <tr><td><code>email</code></td><td>Required and unique. This is the member's sign-in identity and is how the import recognises an existing member.</td></tr>
  <tr><td><code>phone</code></td><td>Optional.</td></tr>
  <tr><td><code>grade</code></td><td><code>Open</code>, <code>Intermediate</code>, <code>Junior</code> or <code>Unknown</code>. Anything else becomes Unknown.</td></tr>
</table>
<h3>The steps</h3>
<ol class="steps">
  <li>Open ${ui('Admin')} → ${ui('Members')} and choose the ${ui('Import CSV')} tab.</li>
  <li>Choose the file, or paste its contents into the box.</li>
  <li>Choose ${ui('Check file (dry run)')}. Nothing is changed; you get a report of what <em>would</em> happen: how many members would be added, updated, deactivated or left unchanged, plus any rows with errors.</li>
  <li>If the numbers are what you expect, choose ${ui('Import')} with the same file.</li>
</ol>
${wide('admin-import-dryrun', 'A dry run reports what the import would do without changing anything.', 80, true)}
<h3>What an import does</h3>
<table>
  <tr><th style="width:26%">A member who is…</th><th>Result</th></tr>
  <tr><td>in the file but not yet in the app</td><td><strong>Added.</strong> Their account is created and they can sign in at once with an emailed code.</td></tr>
  <tr><td>in both, with different details</td><td><strong>Updated</strong> (name, phone, grade).</td></tr>
  <tr><td>in the app but missing from the file</td><td><strong>Deactivated</strong>, exactly as described above. Never deleted.</td></tr>
  <tr><td>an administrator missing from the file</td><td>Left alone, with a warning. Administrators are never deactivated by an import.</td></tr>
</table>
${warn(`<p><strong>The file must be the complete membership list, not just the changes.</strong> Anyone left out is deactivated and loses their bookings. As a safeguard, an import that would deactivate more than five members or 20% of the active membership (whichever is greater) deactivates nobody and reports a warning instead. Always run the dry run first and read the <em>Deactivated</em> count.</p>`)}
<ul>
  <li>A row with a mistake is reported with its row number and skipped; the other rows still import.</li>
  <li>Changing a member's email in the file creates a <em>new</em> member and deactivates the old one, because email is the identity. To correct an email address and keep the member's bookings, ask the person who maintains the system.</li>
  <li>If a newly imported member's email matches a visitor that another member had been bringing, the sponsor is told that the person is now a member and should invite them afresh.</li>
</ul>

<!-- ================================================================== -->
<h1><span class="part">Part 3 · Administrators</span>Acting on behalf of a member</h1>
<p class="lead">Some members will ring the club instead of using the app. Acting on behalf lets an administrator make their arrangements for them.</p>
<ol class="steps">
  <li>Open ${ui('Admin')} → ${ui('Members')}, find the member and choose ${ui('Act on behalf')}.</li>
  <li>A pink banner, “Acting on behalf of [name] — Stop”, appears under the navigation bar and stays there.</li>
  <li>Use the ordinary member screens. My card, Invites, Visitors and every session page now show and change <strong>that member's</strong> arrangements, not yours.</li>
  <li>Choose ${ui('Stop')} in the banner when you have finished.</li>
</ol>
${wide('admin-acting', 'While acting on behalf, the banner stays in view and the page shows the member’s own position.', 120)}
<div class="cols"><div>
<p>While acting on behalf you can do nearly everything the member could: invite, accept or decline, claim a listing, list them on the noticeboard, sign them up with a visitor, arrange or remove a substitute, cancel, and manage teams.</p>
<ul>
  <li>Each action is written to the audit log with your name and theirs.</li>
  <li>The member receives a notification, and an immediate email, saying what an administrator did for them.</li>
  <li>Switching or removing an existing noticeboard listing, and clearing an “unavailable” marker, are not available while acting on behalf.</li>
  <li>Move between screens with the navigation bar. Reloading the page in the browser ends acting on behalf.</li>
</ul>
${warn(`<p>Check the banner before each action and stop as soon as you finish. While it shows, everything you do is done as the other member.</p>`)}
</div>
${phones(['notifications-onbehalf', 'What the member sees afterwards.', 75])}
</div>

<!-- ================================================================== -->
<h1><span class="part">Part 3 · Administrators</span>Managing the programme</h1>

<h2>The yearly cycle</h2>
<ol class="steps">
  <li>Prepare three CSV files from the new year's booklet: weekdays, series and one-off sessions.</li>
  <li>Import them. The programme is created as a <strong>draft</strong>, visible only to administrators.</li>
  <li>Check it, then <strong>publish</strong>. Members can now see it and are notified that it is out.</li>
  <li>Through the year, make small corrections with the editor.</li>
</ol>
<p>The app shows this year and next year together, so next year's programme can be published before the current year ends.</p>

<h2>The three files</h2>
<p>Templates for all three can be downloaded from the top of the Programme screen. Column headings must match exactly; the order does not matter. Dates are written <code>YYYY-MM-DD</code>. The full column list is in the appendix.</p>
<table>
  <tr><th style="width:20%">File</th><th>One row per…</th><th style="width:44%">Main columns</th></tr>
  <tr><td><code>weekdays.csv</code></td><td>Weekday the club plays</td><td>Label, start time, seated-by time, steward's email, notes.</td></tr>
  <tr><td><code>series.csv</code></td><td>Series</td><td>Weekday, name, scoring, format, “best of”, whether substitutes are allowed, notes, and the list of dates.</td></tr>
  <tr><td><code>singles.csv</code></td><td>One-off date</td><td>Date, weekday, kind (Holiday Bridge or No Bridge), title.</td></tr>
</table>

<h2>Importing and publishing</h2>
${wide('admin-prog-import', 'Importing a programme: choose the year and the three files.', 105)}
<ol class="steps">
  <li>Open ${ui('Admin')} → ${ui('Programme')}. Enter the <strong>Year</strong> and choose the three files.</li>
  <li>Choose ${ui('Check files (dry run)')}. All three files are checked together and nothing is saved.</li>
  <li>Correct any reported rows in your files and repeat until the dry run is clean.</li>
  <li>Choose ${ui('Import')}. The year appears under <strong>All programmes</strong> with status <em>draft</em>.</li>
  <li>Review the draft in the editor below. When it is right, choose ${ui('Publish [year]')} beside it.</li>
</ol>
<p>Unlike the member import, a programme import is <strong>all or nothing</strong>: if any row in any file has an error, nothing is saved. The checks include:</p>
<ul>
  <li>every date really falls on the weekday stated for it (the commonest slip when copying from a booklet);</li>
  <li>no two sessions land on the same date and weekday;</li>
  <li>every weekday used by a series or one-off has a row in the weekdays file;</li>
  <li>each steward's email belongs to an active member.</li>
</ul>
${wide('admin-prog-list', 'All programmes, with their status. A draft has a Publish button here.', 70)}
<h3>Re-importing a published year</h3>
<p>A published year is protected. To replace it, tick ${ui('Replace existing programme')} and import again. The replacement is refused if it would remove a session that members have already signed up for; the affected dates are listed so you can deal with them first. Replacing the content does not un-publish the year.</p>

<h2>Editing weekdays, series and sessions</h2>
<p>The <strong>Edit series &amp; sessions</strong> panel on the same screen is for corrections during the year. Choose the year at the top of the panel.</p>
${wide('admin-prog-editor', 'The editor starts with the Weekdays table. The series follow below it.', 105)}
<h3>Weekdays and partner stewards</h3>
<div class="cols"><div>
<p>The Weekdays table shows each weekday's label, times, steward and notes. Choose ${ui('Edit')} to change them.</p>
<p><strong>To appoint or change a partner steward</strong>, pick the member from the <strong>Partner steward</strong> list (or <em>None</em>) and choose ${ui('Save changes')}. Members see the new name and phone number on the Programme screen immediately. The steward must be an active member.</p>
<h3>Series</h3>
<p>Each series is shown as a bar with its weekday, name, format and scoring, and how many pairs or teams are entered. Click the bar to list its sessions with a sign-up count for each. ${ui('Edit series')} changes the name, scoring, format, “best of” figures, whether a one-week substitute is allowed, and the eligibility and general notes.</p>
<h3>Sessions</h3>
<p>${ui('Edit')} beside a session changes its title, date, kind and whether a partner is required. One-off sessions are listed in their own table at the bottom.</p>
<ul>
  <li><strong>Moving a date</strong> is refused while anyone is signed up for that session. The dialog says how many sign-ups there are.</li>
  <li>${ui('Remove session')} deletes the session, cancels every entry for it and notifies the members affected.</li>
</ul>
</div>
${dialogs(['admin-weekday-dialog', 'Choosing a weekday’s partner steward.', 62])}
</div>
${wide('admin-prog-series', 'Series in the editor. One has been opened to show its sessions and sign-up counts.', 112)}
${dialogs(
  ['admin-series-dialog', 'Editing a series.', 62],
  ['admin-session-dialog', 'Editing a session. Sign-ups block a date move.', 62],
)}
${note(`<p>Members whose future sessions are affected by an edit are notified that the programme has changed. Every edit is recorded in the audit log.</p>`)}

<!-- ================================================================== -->
<h1><span class="part">Part 3 · Administrators</span>Broadcasts, audit log and integrity</h1>

<h2>Sending a broadcast</h2>
<p>A broadcast is a club message to members: a closure, a change of venue, a reminder.</p>
<ol class="steps">
  <li>Open ${ui('Admin')} → ${ui('Broadcast')}.</li>
  <li>Enter a <strong>Title</strong> (up to 80 characters) and a <strong>Message</strong> (up to 1000).</li>
  <li>To reach only some members, tick one or more weekdays under <strong>Only members with a future session on</strong>. Leave them all unticked to reach every active member.</li>
  <li>Check the line that says how many members will be notified, then choose ${ui('Preview &amp; send')} and confirm with ${ui('Send')}.</li>
</ol>
${wide('admin-broadcast', 'Composing a broadcast. The recipient count updates as you choose weekdays.', 150)}
<ul>
  <li>The message appears in each member's Notifications and is <strong>emailed immediately</strong>, even to members who have chosen a daily summary.</li>
  <li>A broadcast cannot be recalled once sent, so read the preview carefully.</li>
  <li>Use it sparingly. Members cannot opt out of broadcasts except by turning email off altogether.</li>
</ul>

<h2>The audit log</h2>
<p>${ui('Admin')} → ${ui('Audit log')} lists administrator and system actions, newest first: the time (New Zealand time), who acted, the action, the member affected and the record concerned. ${ui('Details')} expands a row to show the specifics, such as a deactivation reason or the before and after values of an edit.</p>
${wide('admin-audit', 'The audit log.', 140)}
<p>Use <strong>Filter by</strong> to narrow the list by action, by the administrator who acted, or by the member affected. The actions recorded are:</p>
<table>
  <tr><th style="width:30%">Group</th><th>Actions</th></tr>
  <tr><td>Members</td><td>Import, role change, deactivation, reactivation, erasure.</td></tr>
  <tr><td>Programme</td><td>Import, publish, edit.</td></tr>
  <tr><td>On behalf of a member</td><td>Every action taken while acting on behalf: invites and replies, noticeboard listings and claims, visitors, substitutes, cancellations, team changes and calendar links.</td></tr>
  <tr><td>Club messages</td><td>Broadcast sent.</td></tr>
  <tr><td>Automatic</td><td>Integrity repairs; unused visitors cleared out; a visitor becoming a member.</td></tr>
</table>
<p>The log cannot be edited or deleted from the app.</p>

<h2>Integrity check</h2>
<div class="cols"><div>
<p>Every pairing is stored on both partners' cards, and every team member has an entry for each session. The integrity check confirms that these always agree. It runs by itself every night at 3 am; the Integrity screen lets you run it on demand.</p>
<ul>
  <li>${ui('Run check')} examines every future session and team and reports the number checked and any violations found. It changes nothing.</li>
  <li>${ui('Run check and repair')} also fixes what it finds and records each fix in the audit log, with a link to view them.</li>
</ul>
<p>The normal result is “No violations found”. If violations ever appear, run the repair, then tell the person who maintains the system so the cause can be found.</p>
</div>
</div>
${wide('admin-integrity', 'A clean integrity check.', 110, true)}

<h2>An administrator's checklist</h2>
<table>
  <tr><th style="width:28%">When</th><th>What to do</th></tr>
  <tr><td>Before each new year</td><td>Prepare the three programme files; dry run; import; review the draft; set each weekday's steward; publish.</td></tr>
  <tr><td>When members join or leave</td><td>Export the complete list from the membership records; dry run; check the Deactivated count; import.</td></tr>
  <tr><td>When a member rings for help</td><td>Act on behalf; make the change; Stop.</td></tr>
  <tr><td>When the programme changes</td><td>Edit the series or session; send a broadcast if members need to know more than the automatic notice says.</td></tr>
  <tr><td>When a steward changes</td><td>Edit the weekday and choose the new steward.</td></tr>
  <tr><td>Monthly</td><td>Glance at the audit log and run an integrity check. Confirm the club still has at least two administrators.</td></tr>
  <tr><td>On a privacy request</td><td>Deactivate the member; after 30 days, erase.</td></tr>
</table>

<!-- ================================================================== -->
<h1><span class="part">Reference</span>Appendices</h1>

<h2>A. Programme file columns</h2>
<h3>weekdays.csv</h3>
<table>
  <tr><th style="width:24%">Column</th><th>Notes</th></tr>
  <tr><td><code>weekday</code></td><td><code>monday</code> to <code>friday</code>.</td></tr>
  <tr><td><code>label</code></td><td>For example “Monday Afternoon”.</td></tr>
  <tr><td><code>startTime</code>, <code>seatedBy</code></td><td>24-hour <code>HH:MM</code>, for example <code>13:00</code> and <code>12:45</code>.</td></tr>
  <tr><td><code>stewardEmail</code></td><td>Email of an active member, or blank.</td></tr>
  <tr><td><code>notes</code></td><td>Shown to members, for example “No partner required”.</td></tr>
</table>
<h3>series.csv</h3>
<table>
  <tr><th style="width:24%">Column</th><th>Notes</th></tr>
  <tr><td><code>weekday</code>, <code>name</code></td><td>The weekday and the series name as printed.</td></tr>
  <tr><td><code>scoring</code></td><td><code>Scr</code> or <code>Hcp</code>.</td></tr>
  <tr><td><code>format</code></td><td><code>Pairs</code>, <code>Teams</code> or <code>Individual</code>.</td></tr>
  <tr><td><code>bestOfN</code>, <code>bestOfM</code></td><td>For “5 from 6” enter 5 and 6. Blank if not used.</td></tr>
  <tr><td><code>allowSubstitute</code></td><td><code>yes</code> or <code>no</code>. Use <code>no</code> for championship series marked “no substitute”.</td></tr>
  <tr><td><code>eligibilityNote</code>, <code>note</code></td><td>Free text shown to members. Not enforced.</td></tr>
  <tr><td><code>dates</code></td><td>The session dates separated by semicolons, for example <code>2027-02-08;2027-02-15</code>.</td></tr>
  <tr><td><code>teamMin</code>, <code>teamMax</code></td><td>Optional, Teams only. Default 4 and 6.</td></tr>
</table>
<h3>singles.csv</h3>
<table>
  <tr><th style="width:24%">Column</th><th>Notes</th></tr>
  <tr><td><code>date</code>, <code>weekday</code></td><td>The date and the weekday it falls on.</td></tr>
  <tr><td><code>kind</code></td><td><code>holidayBridge</code> or <code>noBridge</code>.</td></tr>
  <tr><td><code>title</code></td><td>For example “Labour Day - Holiday Bridge”.</td></tr>
  <tr><td><code>partnerRequired</code></td><td><code>yes</code> or <code>no</code>. Ignored for No Bridge.</td></tr>
</table>
<p>Files larger than 1 MB or 2,000 rows are rejected.</p>

<h2>B. Limits and timings</h2>
<table>
  <tr><th style="width:44%">Item</th><th>Value</th></tr>
  <tr><td>Sign-in code lifetime</td><td>10 minutes; five attempts per code</td></tr>
  <tr><td>Code requests</td><td>Three per email address in 15 minutes</td></tr>
  <tr><td>Password length</td><td>At least 8 characters</td></tr>
  <tr><td>Invite expiry</td><td>7 days</td></tr>
  <tr><td>Session lock</td><td>At the session's start time</td></tr>
  <tr><td>Reminder</td><td>8 am, 2 days before (adjustable from 0 to 7 days)</td></tr>
  <tr><td>Daily email summary</td><td>5 pm</td></tr>
  <tr><td>Team size</td><td>4 to 6 unless the series says otherwise</td></tr>
  <tr><td>Visitors per member</td><td>20 per programme year; removed automatically after 18 months unused</td></tr>
  <tr><td>Notifications kept</td><td>180 days (the screen shows the latest 50)</td></tr>
  <tr><td>Wait before a member can be erased</td><td>30 days after deactivation</td></tr>
  <tr><td>Nightly integrity check</td><td>3 am</td></tr>
</table>
<p>All dates and times are New Zealand time.</p>

<h2>C. Glossary</h2>
<table>
  <tr><th style="width:26%">Term</th><th>Meaning</th></tr>
  <tr><td>Dance card</td><td>Your personal list of sessions and partners; the “My card” screen.</td></tr>
  <tr><td>Session</td><td>One date on which bridge is played.</td></tr>
  <tr><td>Series</td><td>A named run of sessions on the same weekday.</td></tr>
  <tr><td>Noticeboard</td><td>The “Looking for a partner” and “Available” lists on a session page.</td></tr>
  <tr><td>Claim</td><td>Taking up a “Looking for a partner” listing, which pairs you immediately.</td></tr>
  <tr><td>Visitor</td><td>A non-member partner, sponsored by a member. Has no account.</td></tr>
  <tr><td>Substitute</td><td>A stand-in for one week of a series.</td></tr>
  <tr><td>Partner steward</td><td>The member who helps arrange partners for a weekday.</td></tr>
  <tr><td>Locked</td><td>A session that has started and can no longer be changed.</td></tr>
  <tr><td>Draft / published</td><td>A programme that only administrators can see / that all members can see.</td></tr>
  <tr><td>Dry run</td><td>Checking an import file without changing anything.</td></tr>
</table>

<h2>D. Common questions</h2>
<table>
  <tr><th style="width:38%">Question</th><th>Answer</th></tr>
  <tr><td>I didn't get a sign-in code.</td><td>Check junk mail; wait a minute and request another; then ask an administrator to confirm the email address the club holds for you.</td></tr>
  <tr><td>The app says my account isn't active.</td><td>You are not on the current membership list. Contact an administrator.</td></tr>
  <tr><td>I can't find the member I want to invite.</td><td>They are probably already playing in that session, or are no longer an active member.</td></tr>
  <tr><td>The buttons have gone from a session.</td><td>The session has started and is locked, or you are already booked for it; look for the green line near the top.</td></tr>
  <tr><td>I accepted a series invite and it was refused.</td><td>One of you already has something arranged on one of the dates. The message lists them. Clear the clash, or ask for single dates.</td></tr>
  <tr><td>My partner cancelled. What now?</td><td>You have been listed as looking for a partner automatically. Wait to be claimed, invite someone, or ring the steward.</td></tr>
  <tr><td>I'm not getting push notifications.</td><td>Turn them on for this device in Profile and allow them in the browser. On an iPhone the site must be on your home screen first.</td></tr>
  <tr><td>I get too many emails.</td><td>In Profile choose “Send one summary a day”, or turn email off and rely on the app.</td></tr>
  <tr><td>My name, grade or email is wrong.</td><td>These come from the club's membership records. Ask an administrator.</td></tr>
  <tr><td>The page looks out of date.</td><td>Check your internet connection; the app shows a banner when offline. Then reload.</td></tr>
</table>
`;
}
