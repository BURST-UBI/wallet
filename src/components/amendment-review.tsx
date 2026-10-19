import type { AmendmentOperation, ConstitutionDocument } from "@/lib/types";

export function AmendmentReview({operations, document}: {operations: AmendmentOperation[]; document?: ConstitutionDocument}) {
  return <ol className="divide-y" aria-label="Amendment changes">{operations.map((operation, index) => {
    const number = "ModifyArticle" in operation ? operation.ModifyArticle.article_number : "RepealArticle" in operation ? operation.RepealArticle.article_number : null;
    const current = document?.articles.find(article => article.id === number);
    return <li key={index} className="space-y-3 py-4 first:pt-0 last:pb-0">
      <h3 className="text-ui font-medium">{index + 1}. {"AddArticle" in operation ? "Add article" : "ModifyArticle" in operation ? `Replace article ${number}` : `Repeal article ${number}`}</h3>
      {current && <details className="text-caption"><summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">Current text · {current.title}</summary><p className="whitespace-pre-wrap break-words">{current.text}</p></details>}
      {"AddArticle" in operation ? <div className="space-y-2"><p className="text-ui">{operation.AddArticle.title}</p><p className="whitespace-pre-wrap break-words text-ui">{operation.AddArticle.text}</p></div>
        : "ModifyArticle" in operation ? <p className="whitespace-pre-wrap break-words text-ui">{operation.ModifyArticle.new_text}</p>
        : <p className="text-caption text-muted-foreground">This article will no longer be in force.</p>}
    </li>;
  })}</ol>;
}
