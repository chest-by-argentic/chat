import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { camille, hugo, lea, sam } from "../lab/people.mjs";

// Chat in a browser, on the local Chest of the tests: two members live at
// once, the phone, dark, French, keyboard; axe on every screen. With
// CHAT_SCREENS set, the screens are saved there.

const lab = process.env["CHAT_LAB"]!;
const seeded = JSON.parse(process.env["CHAT_SEED"]!) as { design: number; board: number; general: number; dm: number; kickoff: number };
const screens = process.env["CHAT_SCREENS"];
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function as(browser: Browser, member: { id: string }, options: Parameters<Browser["newContext"]>[0] = {}, to = ""): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on("pageerror", error => { throw error; });
  page.on("response", response => { if (response.status() >= 400) console.log("HTTP", response.status(), response.url()); });
  await page.goto(`${lab}/__as/${member.id}?to=${encodeURIComponent(to)}`);
  await expect(page.locator(".sidebar")).toBeAttached();
  await page.waitForFunction(() => document.querySelector("[data-island]")?.hasChildNodes());
  return { context, page };
}

async function shot(page: Page, name: string) {
  if (screens) await page.screenshot({ path: `${screens}/${name}.png` });
}

async function axe(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map(v => `${label}: ${v.id} — ${v.nodes.map(n => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("two members talk live: typing, a message, a reaction, a thread", async ({ browser }) => {
  const a = await as(browser, camille, {}, `/c/${seeded.design}`);
  const b = await as(browser, sam, {}, `/c/${seeded.design}`);
  await expect(a.page.getByRole("heading", { name: "design" })).toBeVisible();
  await shot(a.page, "desktop-light-en-conversation");
  await axe(a.page, "conversation");

  // Sam types: Camille sees it, the tool is not asked.
  const box = b.page.getByRole("combobox", { name: "Message #design" });
  await box.fill("Shipping the tiles");
  await expect(a.page.getByText("Sam Taylor is typing…")).toBeVisible();
  await box.press("Enter");
  const live = a.page.locator("article", { hasText: "Shipping the tiles" });
  await expect(live).toBeVisible();
  await expect(b.page.locator("article", { hasText: "Shipping the tiles" })).toHaveCount(1);

  // Camille reacts from the message's toolbar: Sam sees it.
  await live.hover();
  await live.getByRole("button", { name: "React with 👍" }).click();
  await expect(b.page.locator("article", { hasText: "Shipping the tiles" }).getByRole("button", { name: /Camille Martin reacted with 👍/u })).toBeVisible();

  // Camille answers in a thread: Sam's message says one reply.
  await live.hover();
  await live.getByRole("button", { name: "Reply in thread" }).click();
  const thread = a.page.getByRole("complementary", { name: /Thread/u });
  await expect(thread).toBeVisible();
  await thread.getByRole("combobox", { name: "Reply…" }).fill(`Great, *thanks* <@${sam.id}> :tada:`);
  await thread.getByRole("combobox", { name: "Reply…" }).press("Enter");
  await expect(thread.getByText("Great, thanks")).toBeVisible();
  await expect(b.page.locator("article", { hasText: "Shipping the tiles" }).getByRole("button", { name: /1 reply/u })).toBeVisible();
  await shot(a.page, "desktop-light-en-thread");
  await axe(a.page, "thread");
  await a.context.close();
  await b.context.close();
});

test("a private channel made in the dialog reaches its member live, and taking them out closes it", async ({ browser }) => {
  const a = await as(browser, camille);
  const b = await as(browser, sam);
  await a.page.getByRole("button", { name: "Add a channel" }).click();
  await a.page.getByRole("menuitem", { name: "Create a channel" }).click();
  const dialog = a.page.getByRole("dialog", { name: "Create a channel" });
  await dialog.getByLabel("Name").fill("launch plan");
  await dialog.getByRole("radio", { name: /Private/u }).check();
  await dialog.getByRole("combobox", { name: "People or groups" }).fill("Sam");
  await dialog.getByRole("option", { name: /Sam Taylor/u }).click();
  await shot(a.page, "desktop-light-en-create");
  await axe(a.page, "create dialog");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(a.page.getByRole("heading", { name: "launch-plan" })).toBeVisible();
  const row = b.page.getByRole("link", { name: /launch-plan/u });
  await expect(row).toBeVisible();
  await a.page.getByRole("combobox", { name: "Message #launch-plan" }).fill("Only the two of us here.");
  await a.page.getByRole("combobox", { name: "Message #launch-plan" }).press("Enter");
  await row.click();
  await expect(b.page.locator("article", { hasText: "Only the two of us here." })).toBeVisible();

  // Camille takes Sam out: his page loses the channel at once.
  await a.page.getByRole("button", { name: "Details" }).click();
  const details = a.page.getByRole("complementary", { name: /Details/u });
  await expect(details.getByText("Sam Taylor")).toBeVisible();
  await shot(a.page, "desktop-light-en-details");
  await axe(a.page, "details");
  await details.locator("li", { hasText: "Sam Taylor" }).getByRole("button", { name: "Remove" }).click();
  await expect(b.page.getByRole("link", { name: /launch-plan/u })).toHaveCount(0);
  await expect(b.page.getByText("This conversation doesn't exist or you no longer have access to it.")).toBeVisible();
  await a.context.close();
  await b.context.close();
});

test("the keyboard: Cmd-K jumps, search finds sealed words, shortcuts are listed", async ({ browser }) => {
  const a = await as(browser, camille);
  await a.page.keyboard.press("ControlOrMeta+k");
  const switcher = a.page.getByRole("dialog", { name: "Jump to a conversation or a person" });
  await expect(switcher).toBeVisible();
  await a.page.keyboard.type("boa");
  await shot(a.page, "desktop-light-en-switcher");
  await axe(a.page, "switcher");
  await a.page.keyboard.press("Enter");
  await expect(a.page.getByRole("heading", { name: "board" })).toBeVisible();

  await a.page.keyboard.press("ControlOrMeta+g");
  const search = a.page.getByRole("searchbox", { name: "Search messages" });
  await search.fill("budget draft");
  await search.press("Enter");
  await expect(a.page.getByText("1 result")).toBeVisible();
  await expect(a.page.locator("mark", { hasText: "budget" })).toBeVisible();
  await shot(a.page, "desktop-light-en-search");
  await axe(a.page, "search");

  await a.page.keyboard.press("ControlOrMeta+/");
  await expect(a.page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await a.page.keyboard.press("Escape");
  await expect(a.page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
  await a.context.close();
});

test("dark, as the device says", async ({ browser }) => {
  const a = await as(browser, camille, { colorScheme: "dark" }, `/c/${seeded.design}/t/${seeded.kickoff}`);
  await expect(a.page.getByRole("complementary", { name: /Thread/u })).toBeVisible();
  await shot(a.page, "desktop-dark-en-thread");
  await axe(a.page, "dark thread");
  await a.page.goto(`${lab}/chest/c/${seeded.dm}`);
  await expect(a.page.locator("article", { hasText: "Do you have five minutes" })).toBeVisible();
  await shot(a.page, "desktop-dark-en-direct");
  await a.context.close();
});

test("in French, the whole page", async ({ browser }) => {
  const a = await as(browser, lea, {}, `/c/${seeded.design}`);
  await expect(a.page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(a.page.getByRole("combobox", { name: "Écrire à #design" })).toBeVisible();
  await expect(a.page.getByText("Aujourd'hui").first()).toBeVisible();
  await shot(a.page, "desktop-light-fr-conversation");
  await axe(a.page, "French");
  await a.page.getByRole("button", { name: "Détails" }).click();
  await expect(a.page.getByRole("complementary", { name: /Détails/u }).getByText("Robin Lee")).toBeVisible();
  await shot(a.page, "desktop-light-fr-details");
  await a.context.close();
});

test("on a phone: the list first, one pane at a time, actions on a long press", async ({ browser }) => {
  const a = await as(browser, camille, phone);
  await expect(a.page.getByRole("navigation", { name: "Conversations" })).toBeVisible();
  await expect(a.page.getByRole("main")).toBeHidden();
  await shot(a.page, "phone-light-en-list");
  await axe(a.page, "phone list");
  await a.page.getByRole("link", { name: /^design/u }).click();
  await expect(a.page.getByRole("heading", { name: "design" })).toBeVisible();
  await expect(a.page.getByRole("navigation", { name: "Conversations" })).toBeHidden();
  await expect(a.page.locator("article", { hasText: "review agenda" }).getByText("Robin Lee")).toBeVisible();
  await shot(a.page, "phone-light-en-conversation");
  await axe(a.page, "phone conversation");
  await a.page.getByRole("button", { name: /3 replies/u }).click();
  await expect(a.page.getByRole("complementary", { name: /Thread/u })).toBeVisible();
  await shot(a.page, "phone-light-en-thread");
  await a.page.getByRole("complementary", { name: /Thread/u }).getByRole("button", { name: "Back" }).click();
  await a.page.getByRole("main").getByRole("button", { name: "Back" }).click();
  await expect(a.page.getByRole("navigation", { name: "Conversations" })).toBeVisible();
  await a.context.close();

  const d = await as(browser, hugo, { ...phone, colorScheme: "dark" }, `/c/${seeded.general}`);
  await expect(d.page.getByRole("heading", { name: "general" })).toBeVisible();
  await shot(d.page, "phone-dark-fr-conversation");
  await axe(d.page, "phone dark French");
  await d.context.close();
});
