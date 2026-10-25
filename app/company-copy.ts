"use client";

import { companyUiCopy } from "@/lib/company-ui-copy";
import { useUiLocale } from "./ui-locale";

export function useCompanyCopy() {
  const { locale } = useUiLocale();
  return companyUiCopy(locale);
}
