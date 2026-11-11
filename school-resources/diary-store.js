import { validateDiary } from "./diary-model.js";
export const DIARY_STORAGE_KEY = "mml:school-music-diary:v1";
export const DIARY_PREVIOUS_KEY = DIARY_STORAGE_KEY + ":previous";
export const MAX_DIARY_FILE = 1048576;
const MAX_DEVICE_FILE = MAX_DIARY_FILE * 2 + 2048;
export function withDiaryLock(lockManager, task) {
  if (typeof lockManager?.request !== "function")
    return Promise.reject(
      Error(
        "Device saving is unavailable in this browser. Use JSON backups instead.",
      ),
    );
  return lockManager.request(DIARY_STORAGE_KEY, { mode: "exclusive" }, task);
}
export function parseDiary(text) {
  if (typeof text !== "string" || text.length > MAX_DIARY_FILE)
    throw Error("Choose a diary backup smaller than 1 MB.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error("This is not a valid diary JSON backup.");
  }
  return validateDiary(data);
}
function readData(storage, key) {
  const text = storage.getItem(key);
  if (text === null) return undefined;
  if (text.length > MAX_DEVICE_FILE)
    throw Error("The saved diary is too large. Import a backup instead.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error("The saved diary could not be read. Import a backup instead.");
  }
  return data;
}
function validateEnvelope(data) {
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.revision !== "string" ||
    !data.revision.trim() ||
    data.revision.length > 100 ||
    typeof data.savedAt !== "string" ||
    !Number.isFinite(Date.parse(data.savedAt))
  )
    throw Error("The saved diary has invalid version information.");
  return {
    revision: data.revision,
    savedAt: data.savedAt,
    diary: validateDiary(data.diary),
  };
}
export function readDeviceDiary(storage) {
  const data = readData(storage, DIARY_STORAGE_KEY);
  return data === undefined ? null : validateEnvelope(data);
}
export function readPreviousDiary(storage) {
  const data = readData(storage, DIARY_STORAGE_KEY);
  if (data && Object.hasOwn(data, "previous"))
    return data.previous === null ? null : validateEnvelope(data.previous);
  // Compatibility with an early local development copy; new writes use one atomic envelope.
  const previous = readData(storage, DIARY_PREVIOUS_KEY);
  return previous === undefined ? null : validateEnvelope(previous);
}
export function saveDeviceDiary(
  storage,
  diary,
  expectedRevision,
  { revision = crypto.randomUUID(), savedAt = new Date().toISOString() } = {},
) {
  const current = readDeviceDiary(storage);
  if ((current?.revision || null) !== expectedRevision)
    throw Error(
      "Another tab changed the saved diary. Load the saved version or download your current backup before deciding which to keep.",
    );
  const clean = validateDiary(diary);
  if (current && JSON.stringify(current.diary) === JSON.stringify(clean))
    return current;
  const envelope = { revision, savedAt, diary: clean };
  if (JSON.stringify(envelope).length > MAX_DIARY_FILE)
    throw Error(
      "This diary is too large for device saving. Download a backup instead.",
    );
  // localStorage replaces one key atomically: quota/write failure preserves both versions.
  const text = JSON.stringify({ ...envelope, previous: current });
  if (text.length > MAX_DEVICE_FILE)
    throw Error(
      "The device copy is too large. Download a JSON backup instead.",
    );
  storage.setItem(DIARY_STORAGE_KEY, text);
  return envelope;
}
export function restorePreviousDiary(storage, expectedRevision, options = {}) {
  const current = readDeviceDiary(storage);
  if ((current?.revision || null) !== expectedRevision)
    throw Error(
      "Another tab changed the saved diary. Load it before recovering a previous copy.",
    );
  const previous = readPreviousDiary(storage);
  if (!previous) throw Error("There is no previous device copy to recover.");
  return saveDeviceDiary(storage, previous.diary, expectedRevision, options);
}
export function forgetDeviceDiary(storage, expectedRevision) {
  const current = readDeviceDiary(storage);
  if ((current?.revision || null) !== expectedRevision)
    throw Error(
      "Another tab changed the saved diary. Load it before removing the device copy.",
    );
  // Remove recovery first: if storage fails, keep the current saved programme.
  storage.removeItem(DIARY_PREVIOUS_KEY);
  storage.removeItem(DIARY_STORAGE_KEY);
}
