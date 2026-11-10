# Safe attendant app update

Use fictional test accounts on the pilot phone. Keep sales and photos on the phone; never clear site data. Build/version state has no dedicated hi-fi board.

1. Open the prior attendant build, then deploy the updated staging build. Open sign-in with no capture and an empty outbox. Expect an update at a safe point without clearing storage.
2. Sign in using a first-password test account. Expect the first-password screen, without an invalid-response error.
3. Start a capture and make a new worker available. Expect no reload during card entry, details or camera use. Finish saving; expect the saved sale and photo to remain on the phone.
4. Keep an unsent sale in the outbox and trigger update detection. Expect no activation-triggered reload, including from an update action. Upload normally; only after every unsent sale is acknowledged and capture is idle may the app reload.
5. Repeat with two attendant tabs: capture in one, idle in the other. Expect neither to interrupt the active capture. Include a signed-out account with pending sales: that queue also prevents reload.
6. Go offline and navigate to the attendant sale shell. Expect the generic precached page. Reconnect, finish any capture and upload pending sales; expect the new build at the next safe point.
7. During an API shape mismatch with a different server build, expect “A newer version is ready. Reload to continue.” Its action must obey the same capture/outbox guard. Same-build malformed responses keep the contract-error message.
