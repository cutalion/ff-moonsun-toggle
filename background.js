const LIGHT_ID = "firefox-compact-light@mozilla.org";
const DARK_ID = "firefox-compact-dark@mozilla.org";
const DEFAULT_ID = "default-theme@mozilla.org";
const STORAGE_KEY = "cycleBaseThemeId";

const ICON_PATH = {
  16: "icons/night-day-dark.svg",
  32: "icons/night-day-dark.svg",
};
const ICON_THEME_ICONS = [
  { light: "icons/night-day-dark.svg", dark: "icons/night-day-light.svg", size: 16 },
  { light: "icons/night-day-dark.svg", dark: "icons/night-day-light.svg", size: 32 },
];

function classify(id) {
  if (!id) return "none";
  if (id === LIGHT_ID) return "light";
  if (id === DARK_ID) return "dark";
  if (id === DEFAULT_ID) return "default";
  return "other";
}

let expectedThemeId = null;

async function getActiveTheme() {
  const all = await browser.management.getAll();
  return all.find((ext) => ext.type === "theme" && ext.enabled) || null;
}

async function getCycleBaseId() {
  const stored = await getCycleStorage().get(STORAGE_KEY);
  return stored[STORAGE_KEY] || null;
}

async function setCycleBaseId(id) {
  if (id) {
    await getCycleStorage().set({ [STORAGE_KEY]: id });
  } else {
    await getCycleStorage().remove(STORAGE_KEY);
  }
}

function getCycleStorage() {
  return browser.storage.session || browser.storage.local;
}

async function clearLegacyStorage() {
  await browser.storage.local.remove("otherThemeId");
  if (browser.storage.session) {
    await browser.storage.local.remove(STORAGE_KEY);
  }
}

async function themeExists(id) {
  if (!id) return false;
  try {
    const info = await browser.management.get(id);
    return info?.type === "theme";
  } catch {
    return false;
  }
}

function parseColor(value) {
  if (!value) return null;
  if (Array.isArray(value) && value.length >= 3) return value.slice(0, 3);
  if (typeof value !== "string") return null;

  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const normalized = hex.length === 3
      ? hex.split("").map((char) => char + char).join("")
      : hex;
    return [0, 2, 4].map((index) => parseInt(normalized.slice(index, index + 2), 16));
  }

  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) return rgb.slice(1, 4).map(Number);

  return null;
}

function colorKind(value) {
  const rgb = parseColor(value);
  if (!rgb) return null;

  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance < 0.5 ? "dark" : "light";
}

async function getDefaultAppearance() {
  try {
    const theme = await browser.theme.getCurrent();
    const colors = theme?.colors || {};
    const themeKind = colorKind(colors.toolbar || colors.frame || colors.accentcolor);
    if (themeKind) return themeKind;
  } catch {
    // Fall through to the system color-scheme query below.
  }

  if (globalThis.matchMedia) {
    return globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return null;
}

async function displayKind(themeId) {
  const kind = classify(themeId);
  if (kind !== "default") return kind;
  return (await getDefaultAppearance()) || "default";
}

async function buildCycle(baseId) {
  const cycle = [];
  const add = async (id) => {
    const kind = await displayKind(id);
    if (!cycle.some((item) => item.kind === kind)) {
      cycle.push({ id, kind });
    }
  };

  if (baseId) await add(baseId);
  await add(DARK_ID);
  await add(LIGHT_ID);

  return cycle;
}

async function nextTarget(active) {
  const currentId = active?.id || LIGHT_ID;
  const currentKind = classify(currentId);
  let baseId = await getCycleBaseId();

  if (currentKind === "other" || currentKind === "default") {
    baseId = currentId;
    await setCycleBaseId(baseId);
  } else if (baseId && !(await themeExists(baseId))) {
    baseId = null;
    await setCycleBaseId(null);
  }

  const cycle = await buildCycle(baseId);
  const currentDisplayKind = await displayKind(currentId);
  const currentIndex = cycle.findIndex((item) => item.kind === currentDisplayKind);

  return cycle[(currentIndex + 1) % cycle.length]?.id || DARK_ID;
}

async function refreshIcon() {
  const active = await getActiveTheme();
  const kind = classify(active?.id);
  const target = await nextTarget(active);
  const targetKind = classify(target);

  await browser.action.setIcon({ path: ICON_PATH, themeIcons: ICON_THEME_ICONS });

  let title;
  if (kind === "dark") {
    title = `Theme: Dark — click for ${targetKind === "default" ? "Default" : "Light"}`;
  } else if (kind === "light") {
    title = `Theme: Light — click for ${targetKind === "default" ? "Default" : "Dark"}`;
  } else if (kind === "default") {
    title = `Theme: Default — click for ${targetKind === "light" ? "Light" : "Dark"}`;
  } else {
    title = "Theme: Custom — click for Dark";
  }
  await browser.action.setTitle({ title });
}

async function handleClick() {
  const active = await getActiveTheme();
  const target = await nextTarget(active);
  expectedThemeId = target;

  try {
    await browser.management.setEnabled(target, true);
  } catch (err) {
    expectedThemeId = null;
    console.error("[moonsun-toggle] setEnabled failed:", err);
  }
}

browser.action.onClicked.addListener(handleClick);
browser.management.onEnabled.addListener(async (info) => {
  if (info.type !== "theme") return;
  if (info.id === expectedThemeId) {
    expectedThemeId = null;
  } else if (classify(info.id) === "dark" || classify(info.id) === "light") {
    await setCycleBaseId(null);
  } else {
    await setCycleBaseId(info.id);
  }
  await refreshIcon();
});
browser.management.onDisabled.addListener(async (info) => {
  if (info.type !== "theme") return;
  await refreshIcon();
});
browser.runtime.onStartup.addListener(init);
browser.runtime.onInstalled.addListener(async () => {
  await clearLegacyStorage();
  await browser.storage.session?.remove(STORAGE_KEY);
  await init();
});

async function init() {
  await clearLegacyStorage();

  const active = await getActiveTheme();
  const kind = classify(active?.id);

  if (kind === "dark" || kind === "light") {
    await setCycleBaseId(null);
  } else if (kind === "other" || kind === "default") {
    await setCycleBaseId(active.id);
  }

  await refreshIcon();
}

init();
