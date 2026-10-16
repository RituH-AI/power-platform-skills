---
name: add-scheduled-notifications
description: Internal implementation skill invoked by /add-native for notifications the device schedules itself at times in the app's data (reminders, due dates, appointments), using the template's expo-notifications, with no Firebase or backend.
user-invocable: false
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, AskUserQuestion
model: sonnet
---

**Shared instructions: [shared-instructions.md](${PLUGIN_ROOT}/shared/shared-instructions.md)** - read first.

**Working directory:** before any project read or command, execute
[native-artifact-compatibility.md Step 0](${PLUGIN_ROOT}/shared/references/native-artifact-compatibility.md#0-bind-every-operation-to-the-app-root).
Inherit `/add-native`'s resolved absolute `working_dir`; bind every shell call and
file tool to it, even when this helper starts from another directory.

# Add Scheduled Notifications

Internal helper for `/add-native scheduled-notifications`, `/add-native local-notifications`, `/add-native reminder-notifications`, `/add-native reminders`, `/add-native due-date-reminders`, and `/add-native expo-notifications`.

The device schedules one notification per record at the record's time, such as an open reminder at its due time. The OS shows it at that time even when the app is closed, and it looks like a push notification. No Firebase or backend is involved, so it works on Android and iOS whether or not the app has push notifications.

It is not push: a device schedules only the records it has loaded, so a change made elsewhere reaches a device the next time that device loads the records. A notification that must reach users when something happens elsewhere (another user's action, a server event) is `push-notifications`, sent by Firebase or a backend.

Limits to state in the plan and summary:
- Android may deliver late: the wrap base package has no exact-alarm permission, so Android can delay a notification by up to 75% of the time between scheduling and the due time (at most an hour, longer in Doze).
- Only the 48 soonest are pending at a time (iOS keeps at most 64 per app); later ones are scheduled by a later sync.
- Android 13 and later show notifications only with the Notifications permission: it must stay selected in the wrap wizard's permissions step.

Hard rules:
- Do not install packages or edit `app.config.js` or native config. The template already ships `expo-notifications`.
- Use `expo-notifications` only through `src/native/scheduledNotifications.ts`, which loads it lazily. Never import it anywhere else: it loads its native modules on import, so a static import crashes host apps built without them (for example an older preview app or wrap base) at startup.
- Do not call `Notifications.setNotificationHandler`: on iOS, Firebase Messaging owns foreground presentation, so the wrapper shows notifications that come due with the app open as an in-app alert.
- Never schedule a notification from a screen directly; screens pass their records to `useScheduledNotifications`.

## 1. Verify app and package

```bash
cd -- '<working_dir>' || { echo "BLOCKED: cannot enter working_dir" >&2; exit 1; }
test -f app.config.js && test -f power.config.json && test -f package.json && test -d src || { echo "BLOCKED: working_dir is not an initialized app" >&2; exit 1; }
node -e "const p=require('./package.json'); if (!p.dependencies?.['expo-notifications']) { console.error('MISSING: expo-notifications'); process.exit(1); } console.log('OK: expo-notifications present');"
```

If the package is missing, stop: the app was created from a template without notification support. Do not install it; tell the user that scheduled notifications need an app created from the current template.

## 2. Identify what is scheduled

Resolve from the approved plan, or ask once when standalone:

- **Records:** which records get a notification (for example open reminders: not done, not deleted). Completed or deleted records must drop out, which cancels their notification.
- **Time and text:** the field holding each record's date and time, and the notification title (usually the record's name) and optional body.
- **Screen:** the screen that loads those records and keeps the schedule in sync. A device schedules only after that screen has loaded them.

Each record maps to `{ id, title, body?, date }`, where `date` is an ISO 8601 date-time or a `Date`. Dataverse returns date-times in UTC, which is what the schedule needs.

## 2a. Reconcile requested artifacts

Read and execute [native-artifact-compatibility.md](${PLUGIN_ROOT}/shared/references/native-artifact-compatibility.md)
Steps 1–3 for the scheduled notifications row before any writes or reuse. Inherit the current
approval/mode from `/add-native`; do not repeat a valid scoped approval.
Inspect `src/native/scheduledNotifications.ts` for `syncScheduledNotifications`,
`clearScheduledNotifications`, `requestScheduledNotificationPermission`,
`useScheduledNotifications`, `useScheduledNotificationSession`,
`ScheduledNotification`, and `ScheduledNotificationsResult`; the lazy
`expo-notifications` load; identifier-based reconciliation that cancels only its
own notifications; the 48-notification cap; and serialized syncs. Inspect
`app/(app)/_layout.tsx` for one unconditional `useScheduledNotificationSession`
call, and the records screen for `useScheduledNotifications`. A wrapper that
imports `expo-notifications` statically or cancels every scheduled notification
is not compatible. An incompatible artifact outside approval returns
`NEEDS_CONTEXT` to the owner, or asks standalone.

## 3. Write `src/native/scheduledNotifications.ts`

Apply Step 2a's decision for `src/native/scheduledNotifications.ts`: create when requested
and missing, reuse unchanged only if compatible, or make only the approved scoped
update. Preserve custom code, exports, and callers; do not overwrite from the
example. Screens and layouts import this wrapper, not `expo-notifications` directly.

```ts
// src/native/scheduledNotifications.ts
import { useEffect, useRef } from 'react';
import { Alert, AppState, Platform } from 'react-native';

declare const require: (id: string) => unknown;

type ExpoNotifications = typeof import('expo-notifications');

/** Something the device announces at `date`, such as an open reminder at its due time. */
export interface ScheduledNotification {
  /** Stable id of the record the notification belongs to. */
  id: string;
  title: string;
  body?: string;
  /** ISO 8601 date-time (Dataverse returns UTC, e.g. "2026-10-16T05:10:00Z") or a Date. */
  date: string | Date;
}

export type ScheduledNotificationsResult =
  | { ok: true; scheduled: number }
  | { ok: false; reason: 'UNAVAILABLE' | 'PERMISSION_DENIED' | 'SCHEDULE_FAILED'; message?: string };

/**
 * Every notification this module schedules has the identifier
 * `scheduled_<id>_<date in epoch ms>_<hash of title and body>`, so a record whose time or text
 * changes gets a new identifier, and the schedule reconciles from identifiers alone (they round-trip
 * on both platforms, unlike custom content fields).
 */
const IDENTIFIER_PREFIX = 'scheduled_';
const ANDROID_CHANNEL_ID = 'scheduled';
/**
 * iOS keeps at most 64 pending local notifications per app and silently drops the rest, so only the
 * soonest are scheduled. Later ones are scheduled by a later sync, once earlier ones have passed.
 */
const MAX_SCHEDULED = 48;
/** Times sooner than this aren't newly scheduled: the alarm could land in the past. */
const MIN_LEAD_MS = 5_000;

/**
 * expo-notifications, or null where on-device notifications can't work: on web, and in a host app
 * built without its native modules. expo-notifications loads those modules on import, so a static
 * import would crash such hosts at startup; this lazy require fails safely instead.
 */
function loadNotifications(): ExpoNotifications | null {
  if (Platform.OS === 'web') return null;
  try {
    return require('expo-notifications') as ExpoNotifications;
  } catch {
    return null;
  }
}

/** 32-bit FNV-1a, so changed text produces a new identifier without putting the text in it. */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

interface ScheduleEntry {
  identifier: string;
  id: string;
  title: string;
  body?: string;
  dateMs: number;
}

function toEntry(item: ScheduledNotification): ScheduleEntry | null {
  const dateMs = item.date instanceof Date ? item.date.getTime() : Date.parse(item.date);
  if (!item.id || !Number.isFinite(dateMs)) return null;
  const title = String(item.title ?? '').trim() || 'Reminder';
  const body = String(item.body ?? '').trim() || undefined;
  return {
    identifier: `${IDENTIFIER_PREFIX}${item.id}_${dateMs}_${hashText(`${title}\n${body ?? ''}`)}`,
    id: item.id,
    title,
    body,
    dateMs,
  };
}

async function ensurePermission(notifications: ExpoNotifications): Promise<boolean> {
  const current = await notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await notifications.requestPermissionsAsync()).granted;
}

let androidChannelReady = false;

/**
 * Android 8+ shows a notification only through a channel. High importance shows it as a heads-up
 * banner instead of arriving silently in the shade.
 */
async function ensureAndroidChannel(notifications: ExpoNotifications): Promise<void> {
  if (Platform.OS !== 'android' || androidChannelReady) return;
  await notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Reminders',
    description: 'Alerts at the times set in the app',
    importance: notifications.AndroidImportance.HIGH,
    enableVibrate: true,
  });
  androidChannelReady = true;
}

async function reconcile(
  notifications: ExpoNotifications,
  items: readonly ScheduledNotification[],
): Promise<ScheduledNotificationsResult> {
  const now = Date.now();
  const wantedEntries = new Map<string, ScheduleEntry>();
  for (const item of items) {
    const entry = toEntry(item);
    if (entry) wantedEntries.set(entry.identifier, entry);
  }
  const upcoming = [...wantedEntries.values()]
    .filter((entry) => entry.dateMs - now >= MIN_LEAD_MS)
    .sort((a, b) => a.dateMs - b.dateMs)
    .slice(0, MAX_SCHEDULED);
  const wanted = new Set(upcoming.map((entry) => entry.identifier));

  const kept = new Set<string>();
  for (const { identifier } of await notifications.getAllScheduledNotificationsAsync()) {
    if (!identifier.startsWith(IDENTIFIER_PREFIX)) continue; // not ours; leave it alone
    const entry = wantedEntries.get(identifier);
    // Keep a pending notification whose time has already passed while its record is unchanged:
    // Android may deliver an inexact alarm late, and cancelling it now would lose it entirely.
    if (entry && (wanted.has(identifier) || entry.dateMs - now < MIN_LEAD_MS)) {
      kept.add(identifier);
    } else {
      await notifications.cancelScheduledNotificationAsync(identifier);
    }
  }

  const missing = upcoming.filter((entry) => !kept.has(entry.identifier));
  if (missing.length === 0) return { ok: true, scheduled: kept.size };
  if (!(await ensurePermission(notifications))) return { ok: false, reason: 'PERMISSION_DENIED' };
  await ensureAndroidChannel(notifications);
  for (const entry of missing) {
    await notifications.scheduleNotificationAsync({
      identifier: entry.identifier,
      content: { title: entry.title, body: entry.body, sound: 'default', data: { id: entry.id } },
      trigger: {
        type: notifications.SchedulableTriggerInputTypes.DATE,
        date: entry.dateMs,
        channelId: ANDROID_CHANNEL_ID,
      },
    });
  }
  return { ok: true, scheduled: kept.size + missing.length };
}

async function reconcileSafely(items: readonly ScheduledNotification[]): Promise<ScheduledNotificationsResult> {
  const notifications = loadNotifications();
  if (!notifications) return { ok: false, reason: 'UNAVAILABLE' };
  try {
    return await reconcile(notifications, items);
  } catch (error) {
    return { ok: false, reason: 'SCHEDULE_FAILED', message: error instanceof Error ? error.message : String(error) };
  }
}

let queued: readonly ScheduledNotification[] | null = null;
let running: Promise<ScheduledNotificationsResult> | null = null;

async function drain(): Promise<ScheduledNotificationsResult> {
  let result: ScheduledNotificationsResult = { ok: true, scheduled: 0 };
  try {
    while (queued) {
      const next = queued;
      queued = null;
      result = await reconcileSafely(next);
    }
  } finally {
    // Cleared right after the queue empties, so a later sync starts a new drain instead of joining
    // one that has already finished.
    running = null;
  }
  return result;
}

/**
 * Makes the device's scheduled notifications match `items`, which must be every record that should
 * be announced (for example every open reminder the user can see). Each one in the future gets one
 * notification at its time; notifications for records that were completed, deleted, retitled, or
 * moved are cancelled or rescheduled. Asks for notification permission only when something new needs
 * scheduling. Calls are serialized, and a call made while one runs replaces any call still waiting.
 */
export function syncScheduledNotifications(
  items: readonly ScheduledNotification[],
): Promise<ScheduledNotificationsResult> {
  queued = items;
  running ??= drain();
  return running;
}

/** Cancels every notification this module scheduled, for example after the user signs out. */
export function clearScheduledNotifications(): Promise<ScheduledNotificationsResult> {
  return syncScheduledNotifications([]);
}

/** Asks for permission to show notifications if it hasn't been decided yet; true when granted. */
export async function requestScheduledNotificationPermission(): Promise<boolean> {
  const notifications = loadNotifications();
  if (!notifications) return false;
  try {
    return await ensurePermission(notifications);
  } catch {
    return false;
  }
}

function syncAndReport(items: readonly ScheduledNotification[]): void {
  void syncScheduledNotifications(items).then((result) => {
    if (__DEV__ && !result.ok) console.log('[scheduled-notifications]', result.reason, result.message ?? '');
  });
}

/**
 * Keeps the device's scheduled notifications in step with `items`: the records the screen has
 * loaded that should be announced, or undefined while they load (nothing changes until they arrive).
 * Pass a memoized array, and mount it once, on the screen that loads the records. Returning to the
 * app re-syncs: permission may have been granted meanwhile (Android denies a request made while
 * another prompt shows, such as the push notifications one), and passed times free room under the cap.
 */
export function useScheduledNotifications(items: readonly ScheduledNotification[] | undefined): void {
  const latest = useRef(items);

  useEffect(() => {
    latest.current = items;
    if (items) syncAndReport(items);
  }, [items]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && latest.current) syncAndReport(latest.current);
    });
    return () => subscription.remove();
  }, []);
}

/**
 * Mount once, in the signed-in layout. While the user is signed in, a scheduled notification that
 * comes due with the app open is shown as an in-app alert, the same way open-app push messages are:
 * expo-notifications doesn't present it then, and on iOS Firebase Messaging owns foreground
 * presentation, so no notification handler is set. Signing out cancels the schedule.
 */
export function useScheduledNotificationSession(isSignedIn: boolean): void {
  const wasSignedIn = useRef(isSignedIn);

  useEffect(() => {
    if (wasSignedIn.current && !isSignedIn) void clearScheduledNotifications();
    wasSignedIn.current = isSignedIn;
  }, [isSignedIn]);

  useEffect(() => {
    if (!isSignedIn) return undefined;
    let subscription: { remove: () => void } | undefined;
    try {
      subscription = loadNotifications()?.addNotificationReceivedListener(({ request }) => {
        if (request.identifier.startsWith(IDENTIFIER_PREFIX)) {
          Alert.alert(request.content.title ?? 'Reminder', request.content.body ?? undefined);
        }
      });
    } catch {
      subscription = undefined;
    }
    return () => subscription?.remove();
  }, [isSignedIn]);
}
```

## 4. Mount it

Apply Step 2a's decision for `app/(app)/_layout.tsx` and the records screen: add the calls
when missing, reuse unchanged only if compatible, or make only the approved scoped update.

In `app/(app)/_layout.tsx`, call the session hook once, unconditionally, right after `useAuth()` and before any early return:

```tsx
import { useScheduledNotificationSession } from '../../src/native/scheduledNotifications';

export default function AppLayout() {
  const { isSignedIn, isLoading } = useAuth();
  useScheduledNotificationSession(isSignedIn);
  // …existing calls, redirect and return stay unchanged
}
```

On the screen that loads the records, pass the ones to announce, memoized:

```tsx
import { useScheduledNotifications } from '../../src/native/scheduledNotifications';

const scheduled = useMemo(
  () => openReminders?.map((reminder) => ({ id: reminder.id, title: reminder.title, date: reminder.dueDate })),
  [openReminders],
);
useScheduledNotifications(scheduled);
```

During `/create-mobile-app`, this helper runs before the screens exist: add the layout call now, and return the records-screen call to the owner, which records it in that screen's spec for the screen builder. Step 10b rewrites only the layout's `return`, so the layout call stays.

## 5. Type-check and summary

```bash
cd -- '<working_dir>' || { echo "BLOCKED: cannot enter working_dir" >&2; exit 1; }
npx --no-install tsc --noEmit
```

Execute the shared compatibility contract's Step 4 after type-checking. Recheck
the lazy load, every export, identifier-based reconciliation of only this
module's notifications, the cap, the layout call, and the records-screen call.
Type-check success alone is insufficient; do not fix screen/generated files.
Only after the requested artifact contract and TypeScript both pass, return the
shared compatibility result and actual created/updated/reused paths before reporting:

```text
Scheduled notifications : READY
Package present         : expo-notifications
Wrapper                 : src/native/scheduledNotifications.ts
Mounted in              : app/(app)/_layout.tsx (session), <records screen> (sync)
Scheduled records       : <records> at <time field>, titled <title field>
Native config           : not changed
Limits                  : schedules after the device loads the records; Android may deliver late; 48 soonest pending
Wrap note               : keep the Notifications permission selected in the wrap wizard
```

Record the scheduled records, their time field, and the records screen in `memory-bank.md`.
