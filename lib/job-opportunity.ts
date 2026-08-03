/**
 * 応募日台帳は会社単位で照合するため、同じ会社の別求人にも日付が命中し得る。
 * 未応募に応募日が付くのは論理矛盾なので、状態を最終ガードにする。
 */
export function opportunityAppliedOn(
  status: string,
  noteAppliedOn: string,
  ledgerAppliedOn?: string,
) {
  if (status === "未応募") return "";
  return ledgerAppliedOn || noteAppliedOn;
}
