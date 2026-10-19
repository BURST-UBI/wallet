import type { AmendmentOperation, Proposal } from "./types";

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const number = (value: unknown) => typeof value === "string" && /^[1-9]\d*$/.test(value)
  && BigInt(value) <= 18446744073709551615n;

export function validOperations(value: unknown): value is AmendmentOperation[] {
  return Array.isArray(value) && value.length > 0 && value.every(operation => {
    if (!operation || typeof operation !== "object" || Object.keys(operation).length !== 1) return false;
    if (operation.AddArticle) return text(operation.AddArticle.title) && text(operation.AddArticle.text);
    if (operation.ModifyArticle) return number(operation.ModifyArticle.article_number) && text(operation.ModifyArticle.new_text);
    if (operation.RepealArticle) return number(operation.RepealArticle.article_number);
    return false;
  });
}

export function amendmentReadable(proposal: Proposal) {
  return proposal.param !== "constitution" || (proposal.amendment_operations !== undefined
    ? validOperations(proposal.amendment_operations) : text(proposal.amendment_text));
}

export function amendmentCharacters(operations: AmendmentOperation[]) {
  return operations.reduce((sum, operation) => sum + [...("AddArticle" in operation
    ? operation.AddArticle.text : "ModifyArticle" in operation ? operation.ModifyArticle.new_text : "")].length, 0);
}
