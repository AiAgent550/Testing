// Vehicle panel shared by jobs, bookings and customers: what DVLA (and DVSA, once connected) says about the car.
// Status first (MOT, tax, export, recent keeper change), then the facts used in the workshop.
import { api, chip, fmtAgo, fmtMiles, h, plate, t, toast } from "./core.js";
import { locale } from "/assets/i18n.js";

const DAY = 86400000;
const day = iso => (iso ? new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)) : "");
const month = ym => (ym ? new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }).format(new Date(`${ym.slice(0, 7)}-15T12:00:00Z`)) : "");
const daysUntil = iso => Math.floor((Date.parse(`${iso.slice(0, 10)}T23:59:59Z`) - Date.now()) / DAY);
const BODY = { M1: "Car", N1: "Van", N2: "Lorry", N3: "Lorry", M2: "Minibus", M3: "Bus", L1: "Motorbike", L3: "Motorbike" };
// Listed so they get Polish entries.
void [t("Car"), t("Van"), t("Lorry"), t("Minibus"), t("Bus"), t("Motorbike")];
void [t("Black"), t("White"), t("Grey"), t("Silver"), t("Blue"), t("Red"), t("Green"), t("Yellow"), t("Orange"), t("Brown"), t("Beige"), t("Gold"), t("Purple"), t("Bronze"), t("Maroon"), t("Cream"), t("Turquoise"), t("Pink")];

const titleCase = s => String(s || "").toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
export const carName = v => [v.make, v.model, v.year].filter(Boolean).join(" ");
const VAG = new Set(["audi", "volkswagen", "vw", "seat", "skoda", "cupra"]);
/** "2.0 TDI", "2.2 diesel", "1.4 petrol" (same rules as the Hub's server, vehicles/names.ts). */
export function engineLabel(v) {
  const f = String(v.fuel_type || "").toLowerCase();
  if (/electric/.test(f) && !/hybrid/.test(f)) return t("Electric");
  const litres = v.engine_cc > 0 ? (Math.round(v.engine_cc / 100) / 10).toFixed(1) : null;
  const badge = /diesel|heavy oil/.test(f) ? (VAG.has(String(v.make || "").toLowerCase()) ? "TDI" : t("diesel"))
    : /hybrid/.test(f) ? t("hybrid") : /petrol/.test(f) ? t("petrol") : null;
  return [litres, badge].filter(Boolean).join(" ");
}
/** "2.0 TDI · Grey" */
export const carSpec = v => [engineLabel(v), v.colour ? t(titleCase(v.colour)) : null].filter(Boolean).join(" · ");

/** Status chips: MOT, tax, export flag and a recently issued logbook (often a new keeper). */
export function vehicleChips(v) {
  const out = [];
  if (v.mot_expiry) {
    const d = daysUntil(v.mot_expiry);
    if (d < 0 || /not valid/i.test(v.mot_status || "")) out.push(chip("failed", t("MOT expired {date}", { date: day(v.mot_expiry) })));
    else if (d <= 30) out.push(chip("partial", t("MOT due {date}", { date: day(v.mot_expiry) })));
    else out.push(chip("sent", t("MOT until {date}", { date: day(v.mot_expiry) })));
  } else if (v.mot_status && !/no details/i.test(v.mot_status)) out.push(chip("skipped", `MOT: ${v.mot_status}`));
  if (v.tax_status) {
    const s = v.tax_status.toLowerCase();
    if (s === "taxed") out.push(chip("sent", v.tax_due ? t("Taxed until {date}", { date: day(v.tax_due) }) : t("Taxed")));
    else if (s === "sorn") out.push(chip("skipped", "SORN"));
    else if (s === "untaxed") out.push(chip("failed", t("Untaxed")));
    else out.push(chip("skipped", t("Tax: {status}", { status: v.tax_status })));
  }
  if (v.dvla?.marked_for_export) out.push(chip("failed", t("Marked for export")));
  if (v.dvla?.v5c_issued && Date.now() - Date.parse(v.dvla.v5c_issued) < 90 * DAY) out.push(chip("partial", t("New logbook {date}", { date: day(v.dvla.v5c_issued) })));
  return out;
}

/** The full panel. `onChange` is called after a refresh so the page can redraw. */
export function vehiclePanel(v, { onChange } = {}) {
  const x = v.dvla || {};
  const engine = [v.engine_cc ? `${v.engine_cc} cc` : null, v.fuel_type ? t(titleCase(v.fuel_type)) : null].filter(Boolean).join(" · ");
  const body = x.type_approval ? `${BODY[x.type_approval] ? t(BODY[x.type_approval]) : x.type_approval} (${x.type_approval})` : null;
  const rows = [
    [t("First registered"), month(x.first_registered)],
    [t("Engine"), engine],
    [t("Colour"), v.colour ? t(titleCase(v.colour)) : null],
    [t("Body"), body],
    [t("Emissions"), [x.euro_status, x.co2 ? `${x.co2} g/km CO₂` : null].filter(Boolean).join(" · ")],
    [t("Logbook (V5C) issued"), day(x.v5c_issued)],
    [t("Mileage"), v.last_mileage ? fmtMiles(v.last_mileage) : null],
    ["VIN", v.vin || null],
  ].filter(([, val]) => val);

  const refresh = h("button.btn.small.ghost", { type: "button", onclick: async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const { lookup } = await api(`/api/vehicles/${encodeURIComponent(v.id)}/refresh`, { method: "POST" });
      toast(lookup?.found ? t("Vehicle details refreshed.") : t("No new details: the lookup isn't connected or found nothing."));
      await onChange?.();
    } catch (err) { toast(err.message, "bad"); btn.disabled = false; }
  } }, t("Refresh from DVLA"));

  const chips = vehicleChips(v);
  const recentKeeper = x.v5c_issued && Date.now() - Date.parse(x.v5c_issued) < 90 * DAY;
  return h("div.stack", { style: "gap:12px" },
    h("div", { style: "display:flex;gap:14px;align-items:center;flex-wrap:wrap" }, plate(v.reg),
      h("div", { style: "display:grid;gap:2px" },
        h("strong", { style: "font-size:18px" }, carName(v) || t("Details not looked up yet")),
        carSpec(v) ? h("span.muted", carSpec(v)) : null)),
    chips.length ? h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, chips) : null,
    recentKeeper ? h("p.hint", { style: "margin:0" }, t("The logbook was issued recently, so the car may have a new keeper. For keys jobs, check the V5C matches the customer's ID.")) : null,
    rows.length ? h("dl.kv", rows.flatMap(([k, val]) => [h("dt", k), h(k === "VIN" ? "dd.mono" : "dd", val)])) : null,
    v.mot_tests?.length ? h("div.stack", { style: "gap:6px" },
      h("span.muted.small", t("MOT history")),
      h("div.list", v.mot_tests.map(m => h("div.row",
        h("span.title", day(m.date)),
        chip(/pass/i.test(m.result || "") ? "sent" : "failed", /pass/i.test(m.result || "") ? t("Pass") : t("Fail")),
        h("span.sub", m.mileage ? fmtMiles(m.mileage) : "")))))
      : null,
    h("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" },
      refresh,
      v.looked_up_at ? h("span.muted.small", t("Checked {when}", { when: fmtAgo(v.looked_up_at) })) : h("span.muted.small", t("Not checked with DVLA yet"))),
  );
}
