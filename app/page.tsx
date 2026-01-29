"use client";

import React, { useMemo, useState } from "react";

type FormState = {
  age: string;
  job: string;
  incomeMan: string;
  family: string;
  assetsMan: string;
  otherDebtMan: string;
  loanRequestMan: string;
};

type ApiResult = {
  V: string[];
  Lambda: {
    method: string;
    ruleId: string;
    result: "HOLD" | "PASS" | string;
    note?: string;
    flags?: string[];
  };
  Trace: {
    reason: string;
    actions: string[];
    log: {
      E: string;
      V: string;
      Lambda: string;
      Trace: string;
    };
  };
  meta?: {
    model?: string;
    visionNote?: string;
  };
};

const initialForm: FormState = {
  age: "",
  job: "",
  incomeMan: "",
  family: "",
  assetsMan: "",
  otherDebtMan: "",
  loanRequestMan: "",
};

export default function Home() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    // デモなので必須は厳しくしない（空でも動く）
    return !isLoading;
  }, [isLoading]);

  async function onGenerate() {
    setError(null);
    setIsLoading(true);

    // 生成開始時に結果を一度消す（“生成感”が出る）
    setResult(null);

    try {
      const payload = {
        age: form.age ? Number(form.age) : undefined,
        job: form.job || undefined,
        incomeMan: form.incomeMan ? Number(form.incomeMan) : undefined,
        family: form.family || undefined,
        assetsMan: form.assetsMan ? Number(form.assetsMan) : undefined,
        otherDebtMan: form.otherDebtMan ? Number(form.otherDebtMan) : undefined,
        loanRequestMan: form.loanRequestMan ? Number(form.loanRequestMan) : undefined,
      };

      const res = await fetch("/api/generate-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`API error: ${res.status} ${t}`);
      }

      const data = (await res.json()) as ApiResult;
      setResult(data);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setIsLoading(false);

      // 結果が出たら、そのまま V セクションへ自然に導く（デモで強い）
      setTimeout(() => {
        document.getElementById("section-v")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }

  return (
    <main className="min-h-screen bg-white">
      {/* Header (sticky) */}
      <header className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <div className="text-xl font-semibold">EVΛƎ Framework / Design-by-Transparency</div>
          <div className="mt-2 text-sm text-gray-700">
            E – Origin → V – Vision → Λ – Choice → Ǝ – Trace
          </div>
          <div className="mt-1 text-xs text-gray-500">※ 本デモでは、人は意思の起点（E）のみを与えます</div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10 space-y-10">
        {/* Context */}
        <section className="rounded-xl border p-6">
          <h2 className="text-lg font-semibold">Context｜仮想銀行A（Demo）</h2>
          <ul className="mt-3 space-y-1 text-sm text-gray-700 list-disc pl-5">
            <li>対象：住宅購入資金の事前検討</li>
            <li>本デモは実運用ではありません</li>
            <li>融資の可否は決定しません（判断はしないAI）</li>
            <li>結果は Ǝトレースとして保存されます（デモ表示）</li>
          </ul>
        </section>

        {/* E */}
        <section className="rounded-xl border p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">E – Origin｜人間の判断の起点</h2>
            <span className="text-xs text-gray-500">Human input only</span>
          </div>

          <p className="mt-2 text-sm text-gray-700">
            この入力は融資の可否を決定するものではありません。次のステップでは
            <span className="font-semibold">「判断がどのような構造で検討されるか」</span>
            をAIが整理します。
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="年齢" value={form.age} placeholder="例：35" onChange={(v) => setForm({ ...form, age: v })} />
            <Field label="職業（選択式）" value={form.job} placeholder="例：会社員" onChange={(v) => setForm({ ...form, job: v })} />
            <Field label="年収（万円）" value={form.incomeMan} placeholder="例：650" onChange={(v) => setForm({ ...form, incomeMan: v })} />
            <Field label="家族構成（簡易）" value={form.family} placeholder="例：夫婦＋子1人" onChange={(v) => setForm({ ...form, family: v })} />
            <Field label="自己資金（万円）" value={form.assetsMan} placeholder="例：400" onChange={(v) => setForm({ ...form, assetsMan: v })} />
            <Field label="他の借入（万円）" value={form.otherDebtMan} placeholder="例：120" onChange={(v) => setForm({ ...form, otherDebtMan: v })} />
            <Field label="申込金額（万円）" value={form.loanRequestMan} placeholder="例：3800" onChange={(v) => setForm({ ...form, loanRequestMan: v })} />
          </div>

          <button
            disabled={!canSubmit}
            onClick={onGenerate}
            className="mt-6 w-full rounded-lg border px-4 py-3 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
          >
            {isLoading ? "生成中…" : "判断構造を生成する →"}
          </button>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </section>

        {/* Loading scene (演出) */}
        {isLoading && (
          <section className="rounded-xl border p-6">
            <h2 className="text-lg font-semibold">Generating…</h2>
            <p className="mt-2 text-sm text-gray-700">
              V（Vision）をAIが生成し、Λ（Choice）はルールで確定し、Ǝ（Trace）をログとして固定しています。
            </p>

            <div className="mt-5 space-y-3">
              <LoadingRow label="V – Vision" desc="論点を展開中（判断しない）" />
              <LoadingRow label="Λ – Choice" desc="Policy Gate を適用中（実行時の人介在なし）" />
              <LoadingRow label="Ǝ – Trace" desc="再生可能な記録を生成中" />
            </div>

            <div className="mt-5 rounded-lg bg-gray-50 p-4 text-xs text-gray-700">
              <pre className="whitespace-pre-wrap">{`E: 住宅購入資金の事前検討
V: 生成中…
Λ: Policy Gate (MORTGAGE_STD_001)
Ǝ: 記録を固定中…`}</pre>
            </div>
          </section>
        )}

        {/* V */}
        <section id="section-v" className="rounded-xl border p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">V – Vision｜AIが提示する論点（判断しない）</h2>
            <span className="text-xs text-gray-500">
              {result?.meta?.visionNote ? `(${result.meta.visionNote})` : "—"}
            </span>
          </div>

          {!result ? (
            <p className="mt-3 text-sm text-gray-600">
              「判断構造を生成する」を押すと、ここにAI生成の論点が表示されます。
            </p>
          ) : (
            <>
              <ul className="mt-3 space-y-2 text-sm text-gray-700 list-disc pl-5">
                {result.V?.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-gray-500">
                ※ 可否の提示や数値断定は行いません（論点展開に限定）
              </p>
            </>
          )}
        </section>

        {/* Λ */}
        <section className="rounded-xl border p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Λ – Choice｜判断方法の確定（ルール）</h2>
            <span className="text-xs text-gray-500">Rule-based</span>
          </div>

          {!result ? (
            <p className="mt-3 text-sm text-gray-600">
              生成後、ここに Policy Gate の結果（PASS / HOLD）が表示されます。
            </p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <Info label="適用ルール" value={result.Lambda.method} />
                <Info label="Rule ID" value={result.Lambda.ruleId} />
                <Info label="判断状態" value={`${result.Lambda.result}`} />
                <Info label="実行時の人介在" value={result.Lambda.note ?? "なし"} />
              </div>

              {result.Lambda.flags && result.Lambda.flags.length > 0 && (
                <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-800">
                  <div className="text-xs font-semibold text-gray-600">HOLD の要因（ルール側）</div>
                  <ul className="mt-2 list-disc pl-5 space-y-1">
                    {result.Lambda.flags.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-3 text-xs text-gray-500">
                ※ ΛはLLMではなく、事前定義ルールで確定します（実行時に人は介在しません）
              </p>
            </>
          )}
        </section>

        {/* Ǝ */}
        <section className="rounded-xl border p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Ǝ – Trace｜判断理由と責任の記録</h2>
            <span className="text-xs text-gray-500">Reproducible log</span>
          </div>

          {!result ? (
            <p className="mt-3 text-sm text-gray-600">
              生成後、ここに「説明ではない」Trace（再生可能な記録）が表示されます。
            </p>
          ) : (
            <>
              <div className="mt-4 space-y-3 text-sm text-gray-700">
                <div>
                  <div className="font-semibold">判断理由（要約）</div>
                  <div className="mt-1">{result.Trace.reason}</div>
                </div>

                <div>
                  <div className="font-semibold">再検討のための条件例</div>
                  <ul className="mt-1 list-disc pl-5 space-y-1">
                    {result.Trace.actions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-800">
                  <pre className="whitespace-pre-wrap">{`E: ${result.Trace.log.E}
V: ${result.Trace.log.V}
Λ: ${result.Trace.log.Lambda}
Ǝ: ${result.Trace.log.Trace}`}</pre>
                </div>
              </div>

              <div className="mt-4 rounded-lg border p-4 text-sm">
                <div className="font-semibold">決め台詞</div>
                <div className="mt-1 text-gray-700">
                  Ǝトレースが存在する限り、このAIはブラックボックスになりません。
                </div>
              </div>

              <p className="mt-3 text-xs text-gray-500">
                ※ 「説明」ではなく「再生可能な記録（Trace）」として残します
              </p>
            </>
          )}
        </section>

        {/* Footer */}
        <footer className="py-4 text-center text-sm text-gray-600">
          このデモは、金融AIが判断をブラックボックスにしない設計が可能であることを示します。
        </footer>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-gray-600">{label}</div>
      <input
        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <div className="text-xs font-semibold text-gray-600">{label}</div>
      <div className="mt-1 font-medium text-gray-900">{value}</div>
    </div>
  );
}

function LoadingRow({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-gray-600">{desc}</div>
      </div>
      <Spinner />
    </div>
  );
}

function Spinner() {
  return (
    <div
      className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900"
      aria-label="loading"
    />
  );
}
