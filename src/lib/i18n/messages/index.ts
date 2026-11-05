import type { Locale } from "../locales";
import { en, type Messages } from "./en";
import { es } from "./es";
import { fil } from "./fil";
import { ja } from "./ja";
import { zhCN } from "./zh-CN";

export type { MessageKey, Messages } from "./en";

export const MESSAGES: Record<Locale, Messages> = { en, fil, es, "zh-CN": zhCN, ja };
