---
name: add-scheduled-notifications
description: Internal implementation skill invoked by /add-native for notifications the device schedules itself at times the app defines (a date-time in its data, such as a due date, appointment or shift start, or a repeating daily or weekly time), using the template's expo-notifications, with no Firebase or backend.
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

Internal helper for `/add-native scheduled-notifications`, `/add-native local-notifications`, `/add-native recurring-notifications`, `/add-native reminder-notifications`, `/add-native reminders`, `/add-native due-date-reminders`, and `/add-native expo-notifications`.

The device shows notifications on its own at times the app defines:

- **once**, at a date-time from the app's data: a task's due date, an appointment, a shift start, an inspection deadline, a booking, an expiry date;
- **repeating**, daily or weekly at a time of day: a daily check-in, a weekly report.

The OS shows each at its time even when the app is closed, and it looks like a push notification. No Firebase or backend is involved, so it works on Android and iOS whether or not the app has push notifications.

It is not push: a device schedules only what it has loaded, so a change made elsewhere reaches a device the next time that device loads it. A notification that must reach users when something happens elsewhere (another user's action, a server event) is `push-notifications`, sent by Firebase or a backend.

Limits to state in the plan and summary:
- Android may deliver a one-off notification late: the wrap base package has no exact-alarm permission, so Android can delay it by up to 75% of the time between scheduling and the time (at most an hour, longer in Doze).
- At most the 48 soonest are pending at a time across the app (iOS keeps at most 64 per app); later ones are scheduled by a later sync.
- Android 13 and later show notifications only with the Notifications permission: it must stay selected in the wrap wizard's permissions step.

Hard rules:
- Do not install packages or edit `app.config.js` or native config. The template already ships `expo-notifications`.
- Use `expo-notifications` only through `src/native/scheduledNotifications.ts`, which loads it lazily. Never import it anywhere else: it loads its native modules on import, so a static import crashes host apps built without them (for example an older preview app or wrap base) at startup.
- Do not call `Notifications.setNotificationHandler`: on iOS, Firebase Messaging owns foreground presentation, so the wrapper shows notifications that come due with the app open as an in-app alert.
- Never schedule or cancel a notification from a screen directly; screens pass their source's notifications to `useScheduledNotifications`.

## 1. Verify app and package

```bash
cd -- '<working_dir>' || { echo "BLOCKED: cannot enter working_dir" >&2; exit 1; }
test -f app.config.js && test -f power.config.json && test -f package.json && test -d src || { echo "BLOCKED: working_dir is not an initialized app" >&2; exit 1; }
node -e "const p=require('./package.json'); if (!p.dependencies?.['expo-notifications']) { console.error('MISSING: expo-notifications'); process.exit(1); } console.log('OK: expo-notifications present');"
```

If the package is missing, stop: the app was created from a template without notification support. Do not install it; tell the user that scheduled notifications need an app created from the current template.

## 2. Identify what is scheduled

Resolve from the approved plan, or ask once when standalone. An app can have several **sources** of notifications, for example appointments from Dataverse and a daily check-in time from a settings screen. For each source, record:

- **Group:** a short name, such as `appointments` or `check-in`. Each source keeps its own group in sync, so one source's sync never cancels another's notifications.
- **Notifications:** which records or settings produce one, for example open tasks (not done, not deleted). Something that drops out of the list has its notification cancelled.
- **When:**
  - Once, at a date-time field. To notify before it, subtract the lead time when mapping (for example 15 minutes before an appointment).
  - For several notices per record, use one notification per notice with distinct ids, such as `<id>:day-before` and `<id>:hour-before`.
  - A date-only field (Dataverse returns it as `YYYY-MM-DD`, which parses as UTC midnight) needs an explicit local time: build a `Date` for that day at the planned hour.
  - Repeating at a time of day: `daily: { hour, minute }`, or `weekly: { weekday, hour, minute }`, where weekday 1 is Sunday, in the device's time zone.
- **Text:** the title (usually the record's name) and optional body.
- **Owner:** the screen that loads the source (a list screen, or the settings screen for a user-set time) and keeps its group in sync. A device schedules only after that screen has loaded it.

Also record what users call these notifications (for example Reminders, Appointments, Shift alerts): it becomes the Android channel name in Step 3.

## 2a. Reconcile requested artifacts

Read and execute [native-artifact-compatibility.md](${PLUGIN_ROOT}/shared/references/native-artifact-compatibility.md)
Steps 1–3 for the scheduled notifications row before any writes or reuse. Inherit the current
approval/mode from `/add-native`; do not repeat a valid scoped approval.
Inspect `src/native/scheduledNotifications.ts` for `syncScheduledNotifications`,
`clearScheduledNotifications`, `requestScheduledNotificationPermission`,
`useScheduledNotifications`, `useScheduledNotificationSession`,
`ScheduledNotification`, `TimeOfDay`, and `ScheduledNotificationsResult`; the lazy
`expo-notifications` load; one-off, daily and weekly times; groups that reconcile
only their own notifications; the app-wide 48-notification cap; and serialized
syncs. Inspect `app/(app)/_layout.tsx` for one unconditional
`useScheduledNotificationSession` call, and each owner screen for its
`useScheduledNotifications` call. A wrapper that imports `expo-notifications`
statically, cancels notifications outside its group, or calls
`setNotificationHandler` is not compatible. An incompatible artifact outside
approval returns `NEEDS_CONTEXT` to the owner, or asks standalone.

## 3. Write `src/native/scheduledNotifications.ts`

Apply Step 2a's decision for `src/native/scheduledNotifications.ts`: create when requested
and missing, reuse unchanged only if compatible, or make only the approved scoped
update. Preserve custom code, exports, and callers; do not overwrite from the
example. Screens and layouts import this wrapper, not `expo-notifications` directly.
Set `ANDROID_CHANNEL_NAME` to what users call these notifications (Step 2).

```ts
// src/native/scheduledNotifications.ts
import { useEffect, useRef } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import type { NotificationTriggerInput } from 'expo-notifications';

declare const require: (id: string) => unknown;

type ExpoNotifications = typeof import('expo-notifications');

/** A time of day in the device's time zone. */
export interface TimeOfDay {
  /** 0–23. */
  hour: number;
  /** 0–59. */
  minute: number;
}

/**
 * A notification the device shows on its own: once at `date`, or repeating `daily` or `weekly`.
 * `id` is unique within its group: the record id, or `<id>:<notice>` for several notices per record.
 * `date` is an ISO 8601 date-time (Dataverse returns UTC) or a Date; `weekday` 1 is Sunday.
 */
export type ScheduledNotification = { id: string; title: string; body?: string } & (
  | { date: string | Date }
  | { daily: TimeOfDay }
  | { weekly: TimeOfDay & { weekday: number } }
);

export type ScheduledNotificationsResult =
  | { ok: true; scheduled: number }
  | { ok: false; reason: 'UNAVAILABLE' | 'PERMISSION_DENIED' | 'SCHEDULE_FAILED'; message?: string };

/**
 * Every notification this module schedules has the identifier
 * `scheduled_<group>_<id>_<when>_<hash of title and body>`: a notification whose time or text
 * changes gets a new identifier, so each group reconciles from identifiers alone (they round-trip on
 * both platforms, unlike custom content fields). Group names never contain `_`, so one group's
 * prefix never matches another's.
 */
const IDENTIFIER_PREFIX = 'scheduled_';
const DEFAULT_GROUP = 'default';
const ALL_GROUPS = '*';
const ANDROID_CHANNEL_ID = 'scheduled';
/** What users call these notifications; Android lists it in the app's notification settings. */
const ANDROID_CHANNEL_NAME = 'Scheduled notifications';
/**
 * iOS keeps at most 64 pending local notifications per app and silently drops the rest, so only the
 * soonest 48 across all groups are scheduled. Later ones are scheduled by a later sync.
 */
const MAX_SCHEDULED = 48;
/** One-off times sooner than this aren't newly scheduled: the alarm could land in the past. */
const MIN_LEAD_MS = 5_000;

type When =
  | { kind: 'once'; ms: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: number; hour: number; minute: number };

interface ScheduleEntry {
  identifier: string;
  id: string;
  title: string;
  body?: string;
  when: When;
  /** Next time it shows, to choose the soonest under the cap. */
  nextMs: number;
}

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

function normalizeGroup(group: string): string {
  return group.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') || DEFAULT_GROUP;
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

const isInRange = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
const isTimeOfDay = ({ hour, minute }: TimeOfDay) => isInRange(hour, 0, 23) && isInRange(minute, 0, 59);

function toWhen(item: ScheduledNotification): When | null {
  if ('date' in item) {
    const ms = item.date instanceof Date ? item.date.getTime() : Date.parse(item.date);
    return Number.isFinite(ms) ? { kind: 'once', ms } : null;
  }
  if ('daily' in item) {
    return isTimeOfDay(item.daily) ? { kind: 'daily', hour: item.daily.hour, minute: item.daily.minute } : null;
  }
  const { weekday, hour, minute } = item.weekly;
  return isTimeOfDay(item.weekly) && isInRange(weekday, 1, 7) ? { kind: 'weekly', weekday, hour, minute } : null;
}

/** The next time `when` shows after `now`, in the device's time zone. */
function nextOccurrence(when: When, now: number): number {
  if (when.kind === 'once') return when.ms;
  const next = new Date(now);
  next.setHours(when.hour, when.minute, 0, 0);
  if (when.kind === 'weekly') next.setDate(next.getDate() + ((when.weekday - 1 - next.getDay() + 7) % 7));
  if (next.getTime() <= now) next.setDate(next.getDate() + (when.kind === 'daily' ? 1 : 7));
  return next.getTime();
}

function whenKey(when: When): string {
  if (when.kind === 'once') return String(when.ms);
  if (when.kind === 'daily') return `d${when.hour}-${when.minute}`;
  return `w${when.weekday}-${when.hour}-${when.minute}`;
}

function toEntry(item: ScheduledNotification, prefix: string, now: number): ScheduleEntry | null {
  const when = toWhen(item);
  if (!item.id || !when) return null;
  const title = String(item.title ?? '').trim() || 'Notification';
  const body = String(item.body ?? '').trim() || undefined;
  return {
    identifier: `${prefix}${item.id}_${whenKey(when)}_${hashText(`${title}\n${body ?? ''}`)}`,
    id: item.id,
    title,
    body,
    when,
    nextMs: nextOccurrence(when, now),
  };
}

function toTrigger(notifications: ExpoNotifications, when: When): NotificationTriggerInput {
  const types = notifications.SchedulableTriggerInputTypes;
  if (when.kind === 'once') return { type: types.DATE, date: when.ms, channelId: ANDROID_CHANNEL_ID };
  if (when.kind === 'daily') {
    return { type: types.DAILY, hour: when.hour, minute: when.minute, channelId: ANDROID_CHANNEL_ID };
  }
  return {
    type: types.WEEKLY,
    weekday: when.weekday,
    hour: when.hour,
    minute: when.minute,
    channelId: ANDROID_CHANNEL_ID,
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
    name: ANDROID_CHANNEL_NAME,
    importance: notifications.AndroidImportance.HIGH,
    enableVibrate: true,
  });
  androidChannelReady = true;
}

/** Makes `group`'s pending notifications match `items`; group null cancels every group's. */
async function reconcile(
  notifications: ExpoNotifications,
  group: string | null,
  items: readonly ScheduledNotification[],
): Promise<ScheduledNotificationsResult> {
  const now = Date.now();
  const prefix = group === null ? IDENTIFIER_PREFIX : `${IDENTIFIER_PREFIX}${group}_`;
  const wantedEntries = new Map<string, ScheduleEntry>();
  for (const item of items) {
    const entry = toEntry(item, prefix, now);
    if (entry) wantedEntries.set(entry.identifier, entry);
  }

  const pending = await notifications.getAllScheduledNotificationsAsync();
  const pendingInOtherGroups = pending.filter(
    ({ identifier }) => identifier.startsWith(IDENTIFIER_PREFIX) && !identifier.startsWith(prefix),
  ).length;
  const upcoming = [...wantedEntries.values()]
    .filter((entry) => entry.when.kind !== 'once' || entry.nextMs - now >= MIN_LEAD_MS)
    .sort((a, b) => a.nextMs - b.nextMs)
    .slice(0, Math.max(0, MAX_SCHEDULED - pendingInOtherGroups));
  const wanted = new Set(upcoming.map((entry) => entry.identifier));

  const kept = new Set<string>();
  for (const { identifier } of pending) {
    if (!identifier.startsWith(prefix)) continue; // another group's, or not this module's
    const entry = wantedEntries.get(identifier);
    // Keep a pending one-off notification whose time has already passed while it's unchanged:
    // Android may deliver an inexact alarm late, and cancelling it now would lose it entirely.
    const isLate = entry?.when.kind === 'once' && entry.nextMs - now < MIN_LEAD_MS;
    if (entry && (wanted.has(identifier) || isLate)) {
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
      trigger: toTrigger(notifications, entry.when),
    });
  }
  return { ok: true, scheduled: kept.size + missing.length };
}

async function reconcileSafely(
  group: string | null,
  items: readonly ScheduledNotification[],
): Promise<ScheduledNotificationsResult> {
  const notifications = loadNotifications();
  if (!notifications) return { ok: false, reason: 'UNAVAILABLE' };
  try {
    return await reconcile(notifications, group, items);
  } catch (error) {
    return { ok: false, reason: 'SCHEDULE_FAILED', message: error instanceof Error ? error.message : String(error) };
  }
}

type Waiter = (result: ScheduledNotificationsResult) => void;
/** Pending work by group, in order: a group's newer call replaces its waiting one and moves last. */
const queue = new Map<string, { items: readonly ScheduledNotification[]; waiters: Waiter[] }>();
let draining = false;

async function drain(): Promise<void> {
  draining = true;
  try {
    while (queue.size > 0) {
      const [key, { items, waiters }] = [...queue][0];
      queue.delete(key);
      const result = await reconcileSafely(key === ALL_GROUPS ? null : key, items);
      waiters.forEach((resolve) => resolve(result));
    }
  } finally {
    draining = false;
  }
}

function enqueue(key: string, items: readonly ScheduledNotification[]): Promise<ScheduledNotificationsResult> {
  return new Promise((resolve) => {
    const waiters: Waiter[] = [resolve];
    // A clear replaces everything waiting before it; a group's call replaces that group's.
    for (const superseded of key === ALL_GROUPS ? [...queue.keys()] : [key]) {
      const entry = queue.get(superseded);
      if (entry) waiters.push(...entry.waiters);
      queue.delete(superseded);
    }
    queue.set(key, { items, waiters });
    if (!draining) void drain();
  });
}

/**
 * Makes `group`'s scheduled notifications match `items`, which must be every notification that
 * source wants (for example one per open task). New ones are scheduled; ones that dropped out,
 * changed time or changed text are cancelled or rescheduled; other groups are left alone. Asks for
 * notification permission only when something new needs scheduling. Calls are serialized, and a
 * call made while one runs replaces the same group's call still waiting.
 */
export function syncScheduledNotifications(
  items: readonly ScheduledNotification[],
  group: string = DEFAULT_GROUP,
): Promise<ScheduledNotificationsResult> {
  return enqueue(normalizeGroup(group), items);
}

/** Cancels every notification this module scheduled, in every group, for example on sign-out. */
export function clearScheduledNotifications(): Promise<ScheduledNotificationsResult> {
  return enqueue(ALL_GROUPS, []);
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

function syncAndReport(items: readonly ScheduledNotification[], group: string): void {
  void syncScheduledNotifications(items, group).then((result) => {
    if (__DEV__ && !result.ok) console.log('[scheduled-notifications]', group, result.reason, result.message ?? '');
  });
}

/**
 * Keeps `group`'s scheduled notifications in step with `items`: every notification the screen's
 * source wants, or undefined while it loads (nothing changes until it arrives). Pass a memoized
 * array, and mount it once per source, on the screen that loads it. Returning to the app re-syncs:
 * permission may have been granted meanwhile (Android denies a request made while another prompt
 * shows, such as the push notifications one), and passed times free room under the cap.
 */
export function useScheduledNotifications(
  items: readonly ScheduledNotification[] | undefined,
  group: string = DEFAULT_GROUP,
): void {
  const latest = useRef(items);

  useEffect(() => {
    latest.current = items;
    if (items) syncAndReport(items, group);
  }, [items, group]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && latest.current) syncAndReport(latest.current, group);
    });
    return () => subscription.remove();
  }, [group]);
}

/**
 * Mount once, in the signed-in layout. While the user is signed in, a scheduled notification that
 * comes due with the app open is shown as an in-app alert, the same way open-app push messages are:
 * expo-notifications doesn't present it then, and on iOS Firebase Messaging owns foreground
 * presentation, so no notification handler is set. Signing out cancels every group's notifications.
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
          Alert.alert(request.content.title ?? 'Notification', request.content.body ?? undefined);
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

Apply Step 2a's decision for `app/(app)/_layout.tsx` and each owner screen: add the calls
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

On each owner screen, pass that source's notifications, memoized, with its group. For example, a task list notifying at each open task's due time, and a settings screen with a user-set daily check-in time:

```tsx
import { useScheduledNotifications } from '../../src/native/scheduledNotifications';

const taskNotifications = useMemo(
  () => openTasks?.map((task) => ({ id: task.id, title: task.name, body: 'Due now', date: task.dueDate })),
  [openTasks],
);
useScheduledNotifications(taskNotifications, 'tasks');

const checkInNotifications = useMemo(
  () =>
    settings
      ? [{ id: 'check-in', title: 'Daily check-in', daily: { hour: settings.checkInHour, minute: 0 } }]
      : undefined,
  [settings],
);
useScheduledNotifications(checkInNotifications, 'check-in');
```

During `/create-mobile-app`, this helper runs before the screens exist: add the layout call now, and return each owner screen's call to the owner, which records it in that screen's spec for the screen builder. Step 10b rewrites only the layout's `return`, so the layout call stays.

## 5. Type-check and summary

```bash
cd -- '<working_dir>' || { echo "BLOCKED: cannot enter working_dir" >&2; exit 1; }
npx --no-install tsc --noEmit
```

Execute the shared compatibility contract's Step 4 after type-checking. Recheck
the lazy load, every export, one-off and repeating times, group isolation, the
cap, the layout call, and each owner screen's call. Type-check success alone is
insufficient; do not fix screen/generated files. Only after the requested
artifact contract and TypeScript both pass, return the shared compatibility
result and actual created/updated/reused paths before reporting:

```text
Scheduled notifications : READY
Package present         : expo-notifications
Wrapper                 : src/native/scheduledNotifications.ts (Android channel "<name>")
Mounted in              : app/(app)/_layout.tsx (session); <owner screen> (<group>) for each source
Sources                 : <group>: <what> at <when>, titled <title>
Native config           : not changed
Limits                  : a device schedules after it loads each source; Android may deliver one-off notifications late; 48 soonest pending
Wrap note               : keep the Notifications permission selected in the wrap wizard
```

Record each source (group, what, when, owner screen) in `memory-bank.md`.
