// Business details printed on invoices and quotes. Bank details come from secrets so they never sit in the repository:
//   wrangler secret put BANK_ACCOUNT_NAME / BANK_SORT_CODE / BANK_ACCOUNT_NUMBER
import type { Env } from "../../lib/env";

export interface Business {
  tradingName: string;
  company: string;
  companyNo: string;
  addressLines: string[];
  phone: string;
  email: string;
  website: string;
  vatRegistered: false;
  bank: { name: string; sortCode: string; account: string } | null;
}

export function business(env: Env): Business {
  const bank = env.BANK_SORT_CODE && env.BANK_ACCOUNT_NUMBER
    ? { name: env.BANK_ACCOUNT_NAME || "M&K Auto Services Limited", sortCode: env.BANK_SORT_CODE, account: env.BANK_ACCOUNT_NUMBER }
    : null;
  return {
    tradingName: env.BUSINESS_NAME || "Curve Performance",
    company: "M&K Auto Services Limited",
    companyNo: "NI719548",
    addressLines: ["28 Millbrook Drive", "Coalisland, BT71 4XH"],
    phone: "07734 272203",
    email: env.MAIL_FROM || "info@curveperformance.co.uk",
    website: "curveperformance.co.uk",
    vatRegistered: false,
    bank,
  };
}

export const legalLine = (b: Business) =>
  `${b.tradingName} is a trading name of ${b.company}. Registered in Northern Ireland, company no. ${b.companyNo}. ` +
  `Registered office: ${b.addressLines.join(", ")}, United Kingdom. Not VAT registered.`;
