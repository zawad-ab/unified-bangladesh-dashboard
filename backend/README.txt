MORNING BRIEF (Windows)

Install
1. Unzip to a permanent folder, e.g. D:\Workplace\Claude Code\news-dashboard
2. Install Python 3.8+ from python.org if you do not have it.
3. Double-click setup.bat. It fetches news, schedules a 6:00 AM refresh and adds a desktop shortcut.
If you move the folder, run setup.bat again.

Daily use
Open "Morning Brief" on the desktop. For news right now, run Refresh-News.bat, then press Reload.
The PC must be on at 6 AM; setup asks Windows to wake it from sleep, if your power settings allow.
If it was off, the task runs when it is next available. Scheduled runs retry for 15 minutes if offline.
If Windows warns about setup.bat because it was downloaded, choose More info > Run anyway.

Uninstall
Task Scheduler > delete "MorningBriefNews". Delete the shortcut and folder.

Limits
- Excerpts come from publishers. They are not AI summaries. Google News results have headlines only.
- "Outlets" counts similar headlines. It is not verification.
- Tiers and importance are simple rules set in fetch_news.py. Edit SOURCES there to add or remove outlets.
- No inline video, no full article inside the page, no Bangla-language feeds.
- Offline: saved headlines and excerpts stay readable; images and source links need internet.
