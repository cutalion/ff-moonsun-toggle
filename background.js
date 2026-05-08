const LIGHT_ID = "firefox-compact-light@mozilla.org";
const DARK_ID = "firefox-compact-dark@mozilla.org";
const STORAGE_KEY = "otherThemeId";

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
  return "other";
}

async function getActiveTheme() {
  const all = await browser.management.getAll();
  return all.find((ext) => ext.type === "theme" && ext.enabled) || null;
}

async function getOtherId() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || null;
}

async function setOtherId(id) {
  if (id === null) {
    await browser.storage.local.remove(STORAGE_KEY);
  } else {
    await browser.storage.local.set({ [STORAGE_KEY]: id });
  }
}

async function themeExists(id) {
  if (!id) return false;
  try {
    const info = await browser.management.get(id);
    return info && info.type === "theme";
  } catch {
    return false;
  }
}

async function nextTarget(currentKind, otherId) {
  if (currentKind === "other") return DARK_ID;
  if (currentKind === "dark") return LIGHT_ID;
  if (currentKind === "light") {
    if (otherId && (await themeExists(otherId))) return otherId;
    await setOtherId(null);
    return DARK_ID;
  }
  return DARK_ID;
}

async function refreshIcon() {
  const active = await getActiveTheme();
  const kind = classify(active?.id);
  const state = kind === "none" ? "light" : kind;
  const otherId = await getOtherId();

  await browser.action.setIcon({ path: ICON_PATH, themeIcons: ICON_THEME_ICONS });

  let title;
  if (state === "light") {
    const next = otherId && (await themeExists(otherId)) ? "custom theme" : "Dark";
    title = `Theme: Light — click for ${next}`;
  } else if (state === "dark") {
    title = "Theme: Dark — click for Light";
  } else {
    const name = active?.name || "custom";
    title = `Theme: ${name} — click for Dark`;
  }
  await browser.action.setTitle({ title });
}

async function handleClick() {
  const active = await getActiveTheme();
  const kind = classify(active?.id);
  const otherId = await getOtherId();
  const target = await nextTarget(kind, otherId);

  try {
    await browser.management.setEnabled(target, true);
  } catch (err) {
    console.error("[moonsun-toggle] setEnabled failed:", err);
  }
}

async function handleThemeEnabled(info) {
  if (info.type !== "theme") return;
  if (classify(info.id) === "other") {
    await setOtherId(info.id);
  }
  await refreshIcon();
}

async function handleThemeDisabled(info) {
  if (info.type !== "theme") return;
  await refreshIcon();
}

async function init() {
  const active = await getActiveTheme();
  if (active && classify(active.id) === "other") {
    await setOtherId(active.id);
  }
  await refreshIcon();
}

browser.action.onClicked.addListener(handleClick);
browser.management.onEnabled.addListener(handleThemeEnabled);
browser.management.onDisabled.addListener(handleThemeDisabled);
browser.management.onUninstalled.addListener(async (info) => {
  if (info.type !== "theme") return;
  const otherId = await getOtherId();
  if (otherId === info.id) await setOtherId(null);
  await refreshIcon();
});
browser.runtime.onStartup.addListener(init);
browser.runtime.onInstalled.addListener(init);

init();
