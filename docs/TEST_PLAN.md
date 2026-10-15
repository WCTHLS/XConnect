# POC test plan

## Test set

- 2 Android phones: basic discovery.
- 5 Android phones: small mesh.
- 1 presenter + 4 attendees: anchor labelling.
- One nearby corridor or second room: false-proximity measurement.

## Record for every run

- number of phones participating;
- time to first discovery;
- API update latency;
- number of peer observations per phone;
- presenter-cluster member count;
- false observations from adjacent space;
- Bluetooth permission / adapter failures.

## Success criterion

For a 5-phone same-room run, the API should return the presenter plus at least three other phones as the estimated Room A cluster within 60 seconds. Record exceptions rather than hiding them.

## Sign-in and admin checks (manual)

Run against a server with sign-in on (a load test needs it off, so do not combine them). Use two
phones for the last item.

1. Google as an attendee: Home loads and the device registers for push.
2. Google, an address on `ADMIN_EMAILS`, choose Admin: the admin tabs open.
3. A non-admin chooses Admin at sign-in: a message appears, they stay on the sign-in screen, and
   no `users` row is created.
4. A new password account chooses Admin: refused, and the Firebase account is gone from the console.
5. A new password account chooses Attendee: a verification email arrives, the bell shows 1, and
   verifying clears it.
6. A password address added to `ADMIN_EMAILS` chooses Admin: the verify card shows until verified,
   then the admin screens open.
7. Remove an admin from `ADMIN_EMAILS`: their next admin request is refused, with no database edit.
8. Airplane mode for 30 seconds mid-session: not signed out.
9. Force a 401 (for example a mismatched `AUTH_AUDIENCE`): the app returns to the sign-in screen
   with the "Signed out" alert and detection stops.
10. A presenter and an attendee on two phones: join, run for a minute, leave, with sign-in on.
