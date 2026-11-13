# WHR-27 admin settings smoke

Use the local real stack or the reviewed staging build with a fictional admin who has settings permission. Never seed live/staging data by hand.

1. Open /admin/settings at 1440 px and at phone width. Check station, timezone, launch/start, cutoff, grace and server-derived upload deadline. Null values say Not set. Zero grace must remain 0 hours.
2. Open giveaway timing. Expect “Campaign dates can't be changed until Whales approves the timing rules”. No editable timing form or confirm control is available until WHR-55.
3. Open photo retention. Verify current days or an empty field for Not set. No board defaults. Try 0, negative, decimal and nonnumeric values; expect accessible validation. A reason is required.
4. Enter positive whole days and a fictional reason. Review changes shows server before/after, reason, and automatic deletion Disabled. Keep editing and Cancel do not save.
5. Review again and Confirm changes. The overview and newest history entry show the saved intent, actor, Lagos timestamp, reason and previous/new values. Reload and check persistence. Photos are never deleted automatically.
6. Clear days and review/confirm to record Not set. Verify no deletion and complete history.
7. Open two sessions. Confirm a competing edit, then confirm the earlier review. Expect a version conflict or stale review explanation and an explicit new review; never silently substitute versions.
8. Retry a confirmation after an interrupted response. The same operation must resolve once. Never label an uncertain result saved.
9. Remove settings permission in a separate authorized local fixture/session. Direct settings/editor access must deny without disclosing values or history; a permission loss before confirmation must not save.
10. Review unchanged days and explain no_change without creating history. Inspect newest-first pagination and accessible empty/error/retry states.

Automated evidence and test counts will be recorded after final validation. Timing editable/review screens intentionally remain locked under WHR-55.
