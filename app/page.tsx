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

    policy?: {
      bank?: string;
      dtiMaxPct?: number;
      downPaymentMinPct?: number;
      annualRatePct?: number;
      years?: number;
    };

    metrics?: {
      monthlyIncomeMan?: number;
      principalMan?: number;
      estMortgagePayMan?: number;
      estOtherDebtPayMan?: number;
      dtiPct?: number;
      downPaymentPct?: number;
      lti?: number;
    };

    required?: {
      reduceLoanManForDTI?: number;
      increaseAssetsManForDownPayment?: number;
      reduceOtherDebtMan?: number;
    };
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

    // ✅ デモ用：確認サイン（軽量）
    confirmed?: boolean;
    confirmedAt?: string; // ISO
    confirmText?: {
      truth?: string;
      noDecision?: string;
    };
  };
  meta?: {
    model?: string;
    visionNote?: string;
    traceId?: string;
    generatedAt?: string;
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

  // ✅ 確認サイン（軽量）
  const [confirmTruth, setConfirmTruth] = useState(false);
  const [confirmNoDecision, setConfirmNoDecision] = useState(false);

  // --- dropdown options ---
  const ageOptions = Array.from({ length: 51 }, (_, i) => {
    const v = String(i + 20); // 20〜70
    return { label: v, value: v };
  });

  const jobOptions = [
    { label: "会社員", value: "会社員" },
    { label: "公務員", value: "公務員" },
    { label: "自営業", value: "自営業" },
    { label: "経営者", value: "経営者" },
    { label: "契約/派遣", value: "契約/派遣" },
    { label: "パート/アルバイト", value: "パート/アルバイト" },
    { label: "専門職（医師/弁護士など）", value: "専門職" },
    { label: "その他", value: "その他" },
  ];

  const familyOptions = [
    { label: "単身", value: "単身" },
    { label: "夫婦", value: "夫婦" },
    { label: "夫婦＋子1人", value: "夫婦＋子1人" },
    { label: "夫婦＋子2人", value: "夫婦＋子2人" },
    { label: "夫婦＋子3人以上", value: "夫婦＋子3人以上" },
    { label: "ひとり親＋子", value: "ひとり親＋子" },
    { label: "二世帯", value: "二世帯" },
    { label: "その他", value: "その他" },
  ];

  // ✅ 最低1つ入力があるか（デモの「反応しない」を避ける）
  const hasAnyInput = useMemo(() => {
    return Object.values(form).some((v) => String(v ?? "").trim().length > 0);
  }, [form]);

  const canSubmit = useMemo(() => {
    // ✅ 生成には「何か入力」＋「確認サイン2つ」必須
    return !isLoading && hasAnyInput && confirmTruth && confirmNoDecision;
  }, [isLoading, hasAnyInput, confirmTruth, confirmNoDecision]);

  async function onGenerate() {
    // ✅ 念のためガード（disabledでも何らかで呼ばれた時に安全）
    if (!canSubmit) return;

    setError(null);
    setIsLoading(true);
    setResult(null);

    try {
      const confirmedAt = new Date().toISOString();

      const payload = {
        age: form.age ? Number(form.age) : undefined,
        job: form.job || undefined,
        incomeMan: form.incomeMan ? Number(form.incomeMan) : undefined,
        family: form.family || undefined,
        assetsMan: form.assetsMan ? Number(form.assetsMan) : undefined,
        otherDebtMan: form.otherDebtMan ? Number(form.otherDebtMan) : undefined,
        loanRequestMan: form.loanRequestMan ? Number(form.loanRequestMan) : undefined,

        // ✅ デモ用：確認サイン情報（API側でTraceに詰めて返すと表示が確実）
        userConfirmed: true,
        confirmedAt,
        confirmText: {
          truth: "入力内容が事実であることを確認しました",
          noDecision: "本デモは融資可否を決定しないことを理解しています",
        },
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
      setTimeout(() => {
        document.getElementById("section-v")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }

  const dtiMax = result?.Lambda?.policy?.dtiMaxPct ?? 35;
  const downMin = result?.Lambda?.policy?.downPaymentMinPct ?? 10;
  const ltiMax = 7; // 今のPolicyGateと合わせる（デモ固定）

  // ✅ ボタン色
  const BTN_BASE = "#FF4500";
  const BTN_HOVER = "#E63E00";

  return (
    <main className="min-h-screen bg-white">
      {/* Header (sticky) */}
      <header className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <div className="text-xl font-semibold">EVΛƎ Framework / Design-by-Transparency</div>

          <FlowStepper phase={isLoading ? "generating" : result ? "done" : "idle"} />

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
            <span className="font-semibold">「判断がどのような構造で検討されるか」</span>をAIが整理します。
          </p>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="年齢"
              value={form.age}
              placeholder="選択してください"
              options={ageOptions}
              onChange={(v) => setForm({ ...form, age: v })}
            />

            <Field
              label="職業（選択式）"
              value={form.job}
              placeholder="選択してください"
              options={jobOptions}
              onChange={(v) => setForm({ ...form, job: v })}
            />

            <Field
              label="年収（万円）"
              value={form.incomeMan}
              placeholder="例：650"
              type="number"
              onChange={(v) => setForm({ ...form, incomeMan: v })}
            />

            <Field
              label="家族構成（簡易）"
              value={form.family}
              placeholder="選択してください"
              options={familyOptions}
              onChange={(v) => setForm({ ...form, family: v })}
            />

            <Field
              label="自己資金（万円）"
              value={form.assetsMan}
              placeholder="例：400"
              type="number"
              onChange={(v) => setForm({ ...form, assetsMan: v })}
            />
            <Field
              label="他の借入（万円）"
              value={form.otherDebtMan}
              placeholder="例：120"
              type="number"
              onChange={(v) => setForm({ ...form, otherDebtMan: v })}
            />
            <Field
              label="申込金額（万円）"
              value={form.loanRequestMan}
              placeholder="例：3800"
              type="number"
              onChange={(v) => setForm({ ...form, loanRequestMan: v })}
            />
          </div>

          {/* ✅ 確認サイン（軽量） */}
          <div className="mt-6 rounded-lg border bg-gray-50 p-4">
            <div className="text-xs font-semibold text-gray-700">確認サイン（デモ）</div>

            <div className="mt-2 space-y-2 text-xs text-gray-700">
              <div className="flex items-start gap-2">
                <input
                  id="confirm-truth"
                  type="checkbox"
                  checked={confirmTruth}
                  onChange={(e) => setConfirmTruth(e.target.checked)}
                  className="mt-0.5"
                />
                <label htmlFor="confirm-truth" className="cursor-pointer select-none">
                  入力内容が事実であることを確認しました
                </label>
              </div>

              <div className="flex items-start gap-2">
                <input
                  id="confirm-nodecision"
                  type="checkbox"
                  checked={confirmNoDecision}
                  onChange={(e) => setConfirmNoDecision(e.target.checked)}
                  className="mt-0.5"
                />
                <label htmlFor="confirm-nodecision" className="cursor-pointer select-none">
                  本デモは融資可否を決定しないことを理解しています
                </label>
              </div>

              <div className="pt-1 text-[11px] text-gray-500">※ 確認情報は Ǝトレース（記録）に含める想定です</div>
            </div>
          </div>

          {/* ✅ 起動ボタン（Eカラー＋押下感＋ホバー） */}
         <button
  disabled={!canSubmit}
  onClick={onGenerate}
  className="
    mt-6 w-full rounded-lg px-4 py-3 text-sm font-semibold
    transition-all duration-150 ease-out
    active:scale-[0.98]
  "
  style={{
    backgroundColor: canSubmit ? "#EA580C" : "#E5E7EB", // 有効:オレンジ / 無効:グレー
    color: canSubmit ? "#ffffff" : "#9CA3AF",
    boxShadow: canSubmit
      ? "0 4px 14px rgba(234,88,12,0.35)"
      : "none",
    cursor: canSubmit ? "pointer" : "not-allowed",
  }}
  onMouseEnter={(e) => {
    if (!canSubmit) return;
    e.currentTarget.style.backgroundColor = "#C2410C";
    e.currentTarget.style.boxShadow = "0 6px 18px rgba(234,88,12,0.45)";
    e.currentTarget.style.transform = "translateY(-1px)";
  }}
  onMouseLeave={(e) => {
    if (!canSubmit) return;
    e.currentTarget.style.backgroundColor = "#EA580C";
    e.currentTarget.style.boxShadow = "0 4px 14px rgba(234,88,12,0.35)";
    e.currentTarget.style.transform = "translateY(0px)";
  }}
>
  {isLoading ? "生成中…" : "検討プロセスを表示する →"}
</button>


          {/* ✅ 何が足りないか表示（デモの体験を壊さない） */}
          {!canSubmit && (
            <div className="mt-2 text-xs text-gray-500 space-y-1">
              {!hasAnyInput && <div>※ まずはどれか1つ入力してください</div>}
              {!confirmTruth && <div>※ 「入力内容が事実であること」を確認してください</div>}
              {!confirmNoDecision && <div>※ 「可否を決定しないこと」を確認してください</div>}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
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
            <p className="mt-3 text-sm text-gray-600">「判断構造を生成する」を押すと、ここにAI生成の論点が表示されます。</p>
          ) : (
            <>
              <ul className="mt-3 space-y-2 text-sm text-gray-700 list-disc pl-5">
                {result.V?.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-gray-500">※ 可否の提示や数値断定は行いません（論点展開に限定）</p>
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
            <p className="mt-3 text-sm text-gray-600">生成後、ここに Policy Gate の結果（PASS / HOLD）が表示されます。</p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <Info label="適用ルール" value={result.Lambda.method} />
                <Info label="Rule ID" value={result.Lambda.ruleId} />
                <Info label="判断状態" value={`${result.Lambda.result}`} />
                <Info label="実行時の人介在" value={result.Lambda.note ?? "なし"} />
              </div>

              {result?.Lambda?.metrics && (
                <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-semibold">数値サマリー（ルール計算）</div>
                    {result?.Lambda?.policy?.bank && <div className="text-xs text-gray-500">{result.Lambda.policy.bank}</div>}
                  </div>

                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Metric label="年収（月）" value={`${result.Lambda.metrics.monthlyIncomeMan ?? "-"} 万円`} />
                    <Metric label="住宅ローン月返済（推定）" value={`${result.Lambda.metrics.estMortgagePayMan ?? "-"} 万円`} />
                    <Metric label="他借入月返済（推定）" value={`${result.Lambda.metrics.estOtherDebtPayMan ?? "-"} 万円`} />

                    <Metric
                      label="返済負担率 DTI"
                      value={`${result.Lambda.metrics.dtiPct ?? "-"} %`}
                      tone={(result.Lambda.metrics.dtiPct ?? 0) > dtiMax ? "warn" : "good"}
                      hint={`DTI(%) = (住宅ローン月返済 + 他借入月返済) ÷ 年収（月） × 100 / 上限=${dtiMax}%`}
                    />

                    <Metric
                      label="自己資金比率（頭金）"
                      value={`${result.Lambda.metrics.downPaymentPct ?? "-"} %`}
                      tone={(result.Lambda.metrics.downPaymentPct ?? 0) < downMin ? "warn" : "good"}
                      hint={`頭金(%) = 自己資金 ÷ 申込金額 × 100 / 最低=${downMin}%`}
                    />

                    <Metric
                      label="申込金額/年収 LTI"
                      value={`${result.Lambda.metrics.lti ?? "-"} 倍`}
                      tone={(result.Lambda.metrics.lti ?? 0) > ltiMax ? "warn" : "good"}
                      hint={`LTI(倍) = 申込金額 ÷ 年収 / 目安上限=${ltiMax}倍（デモ）`}
                    />
                  </div>

                  {(result?.Lambda?.policy?.dtiMaxPct ||
                    result?.Lambda?.policy?.downPaymentMinPct ||
                    result?.Lambda?.policy?.annualRatePct ||
                    result?.Lambda?.policy?.years) && (
                    <div className="mt-3 text-xs text-gray-600">
                      ポリシー：DTI上限 {result.Lambda.policy?.dtiMaxPct ?? "-"}% / 頭金最低{" "}
                      {result.Lambda.policy?.downPaymentMinPct ?? "-"}% / 金利{" "}
                      {result.Lambda.policy?.annualRatePct ?? "-"}% / 期間 {result.Lambda.policy?.years ?? "-"}年
                    </div>
                  )}
                </div>
              )}

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

              <p className="mt-3 text-xs text-gray-500">※ ΛはLLMではなく、事前定義ルールで確定します（実行時に人は介在しません）</p>
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
            <p className="mt-3 text-sm text-gray-600">生成後、ここに「説明ではない」Trace（再生可能な記録）が表示されます。</p>
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

                {result?.Lambda?.required && (
                  <div className="mt-4 rounded-lg border p-4 text-sm">
                    <div className="font-semibold">改善の目安（概算）</div>
                    <div className="mt-1 text-xs text-gray-500">
                      ※ 数値は「架空銀行Aのルール計算」に基づく目安です（可否の決定ではありません）
                    </div>

                    <ul className="mt-3 list-disc pl-5 space-y-1 text-gray-700">
                      {(result.Lambda.required.reduceLoanManForDTI ?? 0) > 0 && (
                        <li>申込金額を約 {result.Lambda.required.reduceLoanManForDTI} 万円下げる（DTI目標に近づける）</li>
                      )}
                      {(result.Lambda.required.increaseAssetsManForDownPayment ?? 0) > 0 && (
                        <li>
                          自己資金を約 {result.Lambda.required.increaseAssetsManForDownPayment} 万円増やす（頭金目標に近づける）
                        </li>
                      )}
                      {(result.Lambda.required.reduceOtherDebtMan ?? 0) > 0 && (
                        <li>他の借入を約 {result.Lambda.required.reduceOtherDebtMan} 万円圧縮する（比率上限に近づける）</li>
                      )}
                      {(result.Lambda.required.reduceLoanManForDTI ?? 0) <= 0 &&
                        (result.Lambda.required.increaseAssetsManForDownPayment ?? 0) <= 0 &&
                        (result.Lambda.required.reduceOtherDebtMan ?? 0) <= 0 && (
                          <li>現条件では主要指標はポリシー範囲内（ただし可否は決定しない）</li>
                        )}
                    </ul>
                  </div>
                )}

                <div className="rounded-lg bg-gray-50 p-4 text-xs text-gray-800">
                  <pre className="whitespace-pre-wrap">{`E: ${result.Trace.log.E}
V: ${result.Trace.log.V}
Λ: ${result.Trace.log.Lambda}
Ǝ: ${result.Trace.log.Trace}`}</pre>

                  <div className="mt-3 border-t pt-3 text-[11px] text-gray-600">
                    <div className="font-semibold text-gray-700">User Confirmation (Demo)</div>
                    <div className="mt-1">Status: {result.Trace.confirmed ? "confirmed" : "—"}</div>
                    <div>Confirmed At: {result.Trace.confirmedAt ?? "—"}</div>
                    {result.meta?.traceId && <div>Trace ID: {result.meta.traceId}</div>}
                    {result.meta?.generatedAt && <div>Generated At: {result.meta.generatedAt}</div>}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg border p-4 text-sm">
                <div className="font-semibold">　</div>
                <div className="mt-1 text-gray-700">Ǝトレースが存在する限り、このAIはブラックボックスになりません。</div>
              </div>

              <p className="mt-3 text-xs text-gray-500">※ 「説明」ではなく「再生可能な記録（Trace）」として残します</p>
            </>
          )}
        </section>

        <footer className="py-4 text-center text-sm text-gray-600">
          このデモは、金融AIが判断をブラックボックスにしない設計が可能であることを示します。
        </footer>
      </div>
    </main>
  );
}

/** Input / Select 両対応の Field */
function Field({
  label,
  value,
  placeholder,
  onChange,
  type = "text",
  options,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  type?: "text" | "number";
  options?: { label: string; value: string }[];
}) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-gray-600">{label}</div>

      {options ? (
        <select
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200 bg-white"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{placeholder ?? "選択してください"}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={type === "number" ? "numeric" : undefined}
        />
      )}
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

function Metric({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn" | "good";
  hint?: string;
}) {
  const styles =
  tone === "warn"
    ? {
        backgroundColor: "#F97316",
        borderColor: "#EA580C",
        boxShadow: "0 6px 16px rgba(249,115,22,0.35)",
        color: "#FFFFFF",
      }
    : tone === "good"
    ? {
        backgroundColor: "#2563EB",
        borderColor: "#1D4ED8",
        boxShadow: "0 6px 16px rgba(37,99,235,0.35)",
        color: "#FFFFFF",
      }
    : {
        backgroundColor: "#FFFFFF",
        borderColor: "#E5E7EB",
      };

return (
  <div
    className="rounded-lg border-2 p-3 transition-all duration-150"
    style={styles}
    title={hint ?? ""}
  >
    <div className="text-xs font-semibold opacity-90">{label}</div>
    <div className="mt-1 font-semibold text-base">{value}</div>
    {hint && <div className="mt-1 text-[11px] opacity-80">ⓘ 式/根拠（hover）</div>}
  </div>
);


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
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" aria-label="loading" />
  );
}

function FlowStepper({ phase }: { phase: "idle" | "generating" | "done" }) {
  const steps = [
    { key: "E", label: "E – Origin", color: "#FF4500" },
    { key: "V", label: "V – Vision", color: "#2563EB" },
    { key: "L", label: "Λ – Choice", color: "#84CC16" },
    { key: "T", label: "Ǝ – Trace", color: "#B833F5" },
  ];

  const [idx, setIdx] = React.useState(0);

  React.useEffect(() => {
    if (phase !== "generating") return;
    setIdx(0);
    const t = setInterval(() => setIdx((v) => (v + 1) % steps.length), 500);
    return () => clearInterval(t);
  }, [phase]);

  const activeIndex = phase === "idle" ? 0 : phase === "done" ? steps.length - 1 : idx;

  return (
    <div className="mt-2 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-gray-600">
        {steps.map((s, i) => {
          const active = i === activeIndex;
          const passed = i < activeIndex;

          const style = active
            ? { backgroundColor: s.color, color: "#fff", borderColor: s.color }
            : passed
            ? { backgroundColor: "#F3F4F6", color: "#111827", borderColor: "#E5E7EB" }
            : { backgroundColor: "transparent", color: "#6B7280", borderColor: "transparent" };

          return (
            <React.Fragment key={s.key}>
              <span className="rounded-full px-2 py-1 transition-all border" style={style}>
                {s.label}
              </span>
              {i < steps.length - 1 && <span className={active || passed ? "text-gray-400" : "text-gray-300"}>→</span>}
            </React.Fragment>
          );
        })}

        {phase === "generating" && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-gray-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-gray-400" />
            running
          </span>
        )}
      </div>
    </div>
  );
}
