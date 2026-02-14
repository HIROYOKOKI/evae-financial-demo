"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type FormState = {
  age: string;
  job: string;
  incomeMan: string;
  family: string;
  assetsMan: string;
  otherDebtMan: string;
  loanRequestMan: string;
};

type Bottleneck = "DTI" | "DOWN" | "LTI" | null;

type ApiResult = {
  V: string[];
  Lambda: {
    method: string;
    ruleId: string;
    result: "HOLD" | "PASS" | string;
    note?: string;
    flags?: string[];

    // ✅ NEW
    gateReasons?: string[];
    bottleneck?: Bottleneck;
    headroom?: {
      dtiPct?: number;
      downPaymentPct?: number;
      lti?: number;
    };
    plans?: Array<{
      title: string;
      impact: string;
      steps: string[];
    }>;

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

const SECTION_STYLE = {
  E: { bg: "rgba(255,21,0,0.06)", bar: "#FF1500" },
  V: { bg: "rgba(9,104,255,0.06)", bar: "#0968FF" },
  L: { bg: "rgba(132,204,22,0.08)", bar: "#84CC16" },
  T: { bg: "rgba(184,51,245,0.06)", bar: "#B833F5" },
} as const;

const lambdaGlow = (isHold: boolean) => ({
  boxShadow: isHold
    ? "0 0 0 1px rgba(132,204,22,0.25), 0 10px 30px rgba(132,204,22,0.22), inset 0 0 0 1px rgba(132,204,22,0.15)"
    : "0 0 0 1px rgba(0,0,0,0.04)",
  backgroundColor: isHold ? "rgba(132,204,22,0.14)" : SECTION_STYLE.L.bg,
});

const traceGlow = (isPass: boolean) => ({
  boxShadow: isPass
    ? "0 0 0 1px rgba(184,51,245,0.18), 0 12px 30px rgba(184,51,245,0.14)"
    : "0 0 0 1px rgba(0,0,0,0.04)",
});

type StepKey = "E" | "V" | "L" | "T";

type VisId = "section-e" | "section-v" | "section-l" | "section-t" | "section-loading";

type VisMap = Record<VisId, boolean>;

/**
 * --- Demo metric model (client fallback) ---
 */
function calcDerivedMetrics(input: {
  incomeMan?: number;
  loanRequestMan?: number;
  assetsMan?: number;
  otherDebtMan?: number;
  annualRatePct: number;
  years: number;
}) {
  const incomeMan = toFinite(input.incomeMan);
  const loanMan = toFinite(input.loanRequestMan);
  const assetsMan = toFinite(input.assetsMan);
  const otherDebtMan = toFinite(input.otherDebtMan);

  const monthlyIncomeMan = incomeMan > 0 ? incomeMan / 12 : 0;
  const principalMan = loanMan;

  const r = input.annualRatePct > 0 ? input.annualRatePct / 100 / 12 : 0;
  const n = Math.max(1, Math.round(input.years * 12));

  let estMortgagePayMan = 0;
  if (principalMan > 0) {
    if (r === 0) {
      estMortgagePayMan = principalMan / n;
    } else {
      const pow = Math.pow(1 + r, n);
      estMortgagePayMan = (principalMan * r * pow) / (pow - 1);
    }
  }

  const estOtherDebtPayMan = otherDebtMan > 0 ? otherDebtMan * 0.02 : 0;

  const dtiPct =
    monthlyIncomeMan > 0
      ? ((estMortgagePayMan + estOtherDebtPayMan) / monthlyIncomeMan) * 100
      : 0;

  const downPaymentPct =
    loanMan + assetsMan > 0 ? (assetsMan / (loanMan + assetsMan)) * 100 : 0;

  const lti = incomeMan > 0 ? loanMan / incomeMan : 0;

  return {
    monthlyIncomeMan: round1(monthlyIncomeMan),
    principalMan: round1(principalMan),
    estMortgagePayMan: round1(estMortgagePayMan),
    estOtherDebtPayMan: round1(estOtherDebtPayMan),
    dtiPct: round1(dtiPct),
    downPaymentPct: round1(downPaymentPct),
    lti: round1(lti),
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function toFinite(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function Home() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ✅ 確認サイン（軽量）
  const [confirmTruth, setConfirmTruth] = useState(false);
  const [confirmNoDecision, setConfirmNoDecision] = useState(false);

  // ✅ Stepper連動（スクロール同期）
  const [activeStep, setActiveStep] = useState<StepKey>("E");

  // --- Action Loop (presentation-friendly) ---
  const consciousRef = useRef<HTMLDivElement | null>(null);
  const actionRef = useRef<HTMLDivElement | null>(null);

  const [showAction, setShowAction] = useState(false);
  type ActionPath = "EMERGENCY" | "LEARNING_A" | "LEARNING_B" | null;
  const [actionPath, setActionPath] = useState<ActionPath>(null);
  const [commitNote, setCommitNote] = useState("");

  const [visible, setVisible] = useState<VisMap>({
    "section-e": true,
    "section-v": false,
    "section-l": false,
    "section-t": false,
    "section-loading": false,
  });

  function scrollTo(step: StepKey) {
    const id =
      step === "E"
        ? "section-e"
        : step === "V"
        ? "section-v"
        : step === "L"
        ? "section-l"
        : "section-t";
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  useEffect(() => {
    const ids = ["section-e", "section-v", "section-l", "section-t"];
    const els = ids
      .map((id) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;

    const keyFromId = (id: string): StepKey =>
      id === "section-e"
        ? "E"
        : id === "section-v"
        ? "V"
        : id === "section-l"
        ? "L"
        : "T";

    const io = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (b.intersectionRatio ?? 0) - (a.intersectionRatio ?? 0))[0];
        if (best?.target?.id) setActiveStep(keyFromId(best.target.id));
      },
      { threshold: [0.35, 0.5, 0.65], rootMargin: "-20% 0px -55% 0px" }
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const ids: VisId[] = [
      "section-e",
      "section-loading",
      "section-v",
      "section-l",
      "section-t",
    ];
    const els = ids
      .map((id) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const id = e.target.id as VisId;
            setVisible((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -10% 0px" }
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [isLoading]);

  // --- dropdown options ---
  const ageOptions = Array.from({ length: 51 }, (_, i) => {
    const v = String(i + 20);
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

  const hasAnyInput = useMemo(() => {
    return Object.values(form).some((v) => String(v ?? "").trim().length > 0);
  }, [form]);

  const canSubmit = useMemo(() => {
    return !isLoading && hasAnyInput && confirmTruth && confirmNoDecision;
  }, [isLoading, hasAnyInput, confirmTruth, confirmNoDecision]);

  async function onGenerate() {
    if (!canSubmit) return;

    setError(null);
    setIsLoading(true);
    setResult(null);

    // Action Loop reset (presentation-friendly)
    setShowAction(false);
    setActionPath(null);
    setCommitNote("");

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
        document.getElementById("section-v")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 50);
    }
  }

  // --- policy defaults (demo) ---
  const annualRate = result?.Lambda?.policy?.annualRatePct ?? 1.5;
  const years = result?.Lambda?.policy?.years ?? 35;

  const dtiMax = result?.Lambda?.policy?.dtiMaxPct ?? 35;
  const downMin = result?.Lambda?.policy?.downPaymentMinPct ?? 10;
  const ltiMax = 7;

  // --- derived metrics (prefer server, fallback to client calc) ---
  const derived = useMemo(() => {
    const server = result?.Lambda?.metrics;
    if (server && Object.values(server).some((v) => typeof v === "number")) {
      return {
        monthlyIncomeMan: server.monthlyIncomeMan ?? 0,
        principalMan: server.principalMan ?? 0,
        estMortgagePayMan: server.estMortgagePayMan ?? 0,
        estOtherDebtPayMan: server.estOtherDebtPayMan ?? 0,
        dtiPct: server.dtiPct ?? 0,
        downPaymentPct: server.downPaymentPct ?? 0,
        lti: server.lti ?? 0,
      };
    }
    return calcDerivedMetrics({
      incomeMan: form.incomeMan ? Number(form.incomeMan) : 0,
      loanRequestMan: form.loanRequestMan ? Number(form.loanRequestMan) : 0,
      assetsMan: form.assetsMan ? Number(form.assetsMan) : 0,
      otherDebtMan: form.otherDebtMan ? Number(form.otherDebtMan) : 0,
      annualRatePct: annualRate,
      years,
    });
  }, [result, form, annualRate, years]);

  const showMetrics = useMemo(() => {
    const hasCore =
      String(form.incomeMan).trim() !== "" ||
      String(form.loanRequestMan).trim() !== "" ||
      String(form.assetsMan).trim() !== "" ||
      String(form.otherDebtMan).trim() !== "";
    return Boolean(result) || hasCore;
  }, [result, form]);

  const decision = (result?.Lambda?.result as "HOLD" | "PASS" | null) ?? null;
  const isHold = decision === "HOLD";
  const isPass = decision === "PASS";

  // PASS/HOLD → 日本語マッピング（語彙統一）
  type RecommendationJP = "適合" | "保留" | "不適合";
  const recommendationJP: RecommendationJP = !result
    ? "保留"
    : result.Lambda.result === "PASS"
    ? "適合"
    : result.Lambda.result === "HOLD"
    ? "保留"
    : "不適合";

  const scrollToAction = () => {
    setShowAction(true);
    setTimeout(
      () => actionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50
    );
  };

  const scrollToConscious = () => {
    consciousRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="min-h-screen" style={{ backgroundColor: "#FFFFFF" }}>
      {/* Header (sticky) */}
      <header
        className="sticky top-0 z-10 border-b"
        style={{ backgroundColor: "rgba(255,255,255,0.90)" }}
      >
        <div className="mx-auto max-w-4xl px-6 py-4">
          <div className="text-xl font-semibold">
            EVΛƎ Framework / Design-by-Transparency
          </div>

          <FlowStepper
            phase={isLoading ? "generating" : result ? "done" : "idle"}
            activeStep={activeStep}
            onStepClick={scrollTo}
            decision={decision}
          />

          <div className="mt-1 text-xs text-gray-500">
            ※ 本デモでは、人は意思の起点（E）のみを与えます
          </div>
        </div>
      </header>

      <div ref={consciousRef} className="mx-auto max-w-4xl px-6 py-10 space-y-10">
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
        <LayerSection
          id="section-e"
          visible={visible["section-e"]}
          style={{
            backgroundColor: SECTION_STYLE.E.bg,
            borderLeft: `6px solid ${SECTION_STYLE.E.bar}`,
          }}
        >
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

          {showMetrics && (
            <div className="mt-6 rounded-lg border bg-gray-50 p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold">数値メトリクス（デモ計算）</div>
                <div className="text-xs text-gray-500">
                  金利 {annualRate}% / 期間 {years}年 / 他債務 月2%（近似）
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Metric
                  label="年収（月）"
                  value={`${derived.monthlyIncomeMan || 0} 万円`}
                  hint={`monthlyIncome = 年収 ÷ 12`}
                />
                <Metric
                  label="住宅ローン月返済（推定）"
                  value={`${derived.estMortgagePayMan || 0} 万円`}
                  hint={`固定金利・${years}年の簡易償却式（0%時は元本/回数）`}
                />
                <Metric
                  label="他借入月返済（推定）"
                  value={`${derived.estOtherDebtPayMan || 0} 万円`}
                  hint={`他債務（月） = 他債務 × 2%`}
                />

                <Metric
                  label="返済負担率 DTI"
                  value={`${derived.dtiPct || 0} %`}
                  tone={(derived.dtiPct || 0) > dtiMax ? "warn" : "good"}
                  hint={`DTI(%) = (住宅ローン月返済 + 他借入月返済) ÷ 年収（月） × 100 / 上限=${dtiMax}%`}
                />

                <Metric
                  label="自己資金比率（頭金）"
                  value={`${derived.downPaymentPct || 0} %`}
                  tone={(derived.downPaymentPct || 0) < downMin ? "warn" : "good"}
                  hint={`頭金(%) = 自己資金 ÷ (申込金額 + 自己資金) × 100 / 最低=${downMin}%`}
                />

                <Metric
                  label="申込金額/年収 LTI"
                  value={`${derived.lti || 0} 倍`}
                  tone={(derived.lti || 0) > ltiMax ? "warn" : "good"}
                  hint={`LTI(倍) = 申込金額 ÷ 年収 / 目安上限=${ltiMax}倍（デモ）`}
                />
              </div>

              <div className="mt-3 text-xs text-gray-500">
                ※ これは「判断」ではなく、Λ（ルール）の前提となる“計算可能な構造”の表示です
              </div>
            </div>
          )}

          <div className="mt-6 rounded-lg border bg-gray-50 p-4">
            <div className="text-xs font-semibold text-gray-700">
              確認サイン（デモ）
            </div>
            <div className="mt-2 space-y-2 text-xs text-gray-700">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmTruth}
                  onChange={(e) => setConfirmTruth(e.target.checked)}
                  className="mt-0.5"
                />
                入力内容が事実であることを確認しました
              </label>

              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmNoDecision}
                  onChange={(e) => setConfirmNoDecision(e.target.checked)}
                  className="mt-0.5"
                />
                本デモは融資可否を決定しないことを理解しています
              </label>

              <div className="pt-1 text-[11px] text-gray-500">
                ※ 確認情報は Ǝトレース（記録）に含める想定です
              </div>
            </div>
          </div>

          <button
            disabled={!canSubmit}
            onClick={onGenerate}
            className="
              mt-6 w-full rounded-lg px-4 py-3 text-sm font-semibold
              transition-all duration-150 ease-out
              disabled:opacity-50 disabled:cursor-not-allowed
              active:scale-[0.98]
            "
            style={{
              backgroundColor: "#FF4500",
              color: "#ffffff",
              boxShadow: "0 4px 14px rgba(255,69,0,0.30)",
              transform: "translateY(0px)",
            }}
            onMouseEnter={(e) => {
              if (!canSubmit) return;
              e.currentTarget.style.backgroundColor = "#E63E00";
              e.currentTarget.style.boxShadow = "0 6px 18px rgba(255,69,0,0.45)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#FF4500";
              e.currentTarget.style.boxShadow = "0 4px 14px rgba(255,69,0,0.30)";
              e.currentTarget.style.transform = "translateY(0px)";
            }}
          >
            {isLoading ? "生成中…" : "検討プロセスを表示する →"}
          </button>

          {!canSubmit ? (
            <div className="mt-2 text-xs text-gray-500">
              ※ 入力＋確認サイン（2つ）で生成できます（デモ演出）
            </div>
          ) : null}

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </LayerSection>

        {/* Loading */}
        {isLoading && (
          <LayerSection
            id="section-loading"
            visible={visible["section-loading"]}
            style={{
              backgroundColor: SECTION_STYLE.V.bg,
              borderLeft: `6px solid ${SECTION_STYLE.V.bar}`,
            }}
          >
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
          </LayerSection>
        )}

        {/* V */}
        <LayerSection
          id="section-v"
          visible={visible["section-v"]}
          style={{
            backgroundColor: SECTION_STYLE.V.bg,
            borderLeft: `6px solid ${SECTION_STYLE.V.bar}`,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              V – Vision｜AIが提示する論点（判断しない）
            </h2>
            <span className="text-xs text-gray-500">
              {result?.meta?.visionNote ? `(${result.meta.visionNote})` : "—"}
            </span>
          </div>

          {!result ? (
            <p className="mt-3 text-sm text-gray-600">
              「検討プロセスを表示する」を押すと、ここにAI生成の論点が表示されます。
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
        </LayerSection>

        {/* Λ */}
        <LayerSection
          id="section-l"
          visible={visible["section-l"]}
          className="transition-all duration-300"
          style={{
            borderLeft: `${isHold ? 10 : 6}px solid ${SECTION_STYLE.L.bar}`,
            ...(lambdaGlow(isHold)),
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              Λ – Choice｜判断方法の確定（ルール）
            </h2>
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

              <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-semibold">数値サマリー（ルール計算）</div>
                  {result?.Lambda?.policy?.bank && (
                    <div className="text-xs text-gray-500">
                      {result.Lambda.policy.bank}
                    </div>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Metric
                    label="年収（月）"
                    value={`${derived.monthlyIncomeMan || 0} 万円`}
                  />
                  <Metric
                    label="住宅ローン月返済（推定）"
                    value={`${derived.estMortgagePayMan || 0} 万円`}
                  />
                  <Metric
                    label="他借入月返済（推定）"
                    value={`${derived.estOtherDebtPayMan || 0} 万円`}
                  />

                  <Metric
                    label="返済負担率 DTI"
                    value={`${derived.dtiPct || 0} %`}
                    tone={(derived.dtiPct || 0) > dtiMax ? "warn" : "good"}
                    hint={`DTI(%) = (住宅ローン月返済 + 他借入月返済) ÷ 年収（月） × 100 / 上限=${dtiMax}%`}
                  />

                  <Metric
                    label="自己資金比率（頭金）"
                    value={`${derived.downPaymentPct || 0} %`}
                    tone={(derived.downPaymentPct || 0) < downMin ? "warn" : "good"}
                    hint={`頭金(%) = 自己資金 ÷ (申込金額 + 自己資金) × 100 / 最低=${downMin}%`}
                  />

                  <Metric
                    label="申込金額/年収 LTI"
                    value={`${derived.lti || 0} 倍`}
                    tone={(derived.lti || 0) > ltiMax ? "warn" : "good"}
                    hint={`LTI(倍) = 申込金額 ÷ 年収 / 目安上限=${ltiMax}倍（デモ）`}
                  />
                </div>

                <div className="mt-3 text-xs text-gray-600">
                  ポリシー：DTI上限 {dtiMax}% / 頭金最低 {downMin}% / 金利 {annualRate}% / 期間 {years}年
                </div>
              </div>

              {/* ✅ HOLD時の見せ方最適化 */}
              {decision === "HOLD" && (
                <div className="mt-4 rounded-lg border p-4 text-sm">
                  <div
                    className="text-xs font-semibold"
                    style={{ color: "#FF1500" }}
                  >
                    HOLD（再検討が必要）
                  </div>

                  {result.Lambda.gateReasons &&
                    result.Lambda.gateReasons.length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs font-semibold text-gray-600">
                          HOLD要因（ゲート理由）
                        </div>
                        <ul className="mt-2 list-disc pl-5 space-y-1 text-gray-800">
                          {result.Lambda.gateReasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {result.Lambda.bottleneck && (
                    <div className="mt-3 text-sm">
                      <span className="text-xs font-semibold text-gray-600">
                        ボトルネック：
                      </span>
                      <span className="font-bold">
                        {result.Lambda.bottleneck === "DTI"
                          ? "DTI（返済負担）"
                          : result.Lambda.bottleneck === "DOWN"
                          ? "頭金比率"
                          : "LTI（年収倍率）"}
                      </span>
                    </div>
                  )}

                  {result.Lambda.plans && result.Lambda.plans.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-gray-600">
                        改善プラン（Plan A/B/C）
                      </div>
                      <div className="mt-2 space-y-3">
                        {result.Lambda.plans.map((p, i) => (
                          <div key={i} className="rounded-lg bg-gray-50 p-3">
                            <div className="font-semibold">{p.title}</div>
                            <div className="mt-1 text-xs text-gray-600">
                              {p.impact}
                            </div>
                            <ul className="mt-2 list-disc pl-5 space-y-1 text-sm text-gray-800">
                              {p.steps.map((s, j) => (
                                <li key={j}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {decision === "PASS" && result.Lambda.headroom && (
                <div className="mt-4 rounded-lg border p-4 text-sm">
                  <div className="text-xs font-semibold text-gray-600">
                    余裕度（境界に対する余白）
                  </div>
                  <div className="mt-3 space-y-3">
                    <HeadroomBar
                      label="DTI余裕"
                      value={result.Lambda.headroom.dtiPct ?? 0}
                      unit="%"
                      color="#0968FF"
                      warnColor="#FF1500"
                    />
                    <HeadroomBar
                      label="頭金余裕"
                      value={result.Lambda.headroom.downPaymentPct ?? 0}
                      unit="%"
                      color="#0968FF"
                      warnColor="#FF1500"
                    />
                    <HeadroomBar
                      label="LTI余裕"
                      value={result.Lambda.headroom.lti ?? 0}
                      unit="倍"
                      color="#0968FF"
                      warnColor="#FF1500"
                    />
                  </div>
                  <div className="mt-2 text-[11px] text-gray-500">
                    ※ プラスが余裕、マイナスが不足/超過
                  </div>
                </div>
              )}

              <p className="mt-3 text-xs text-gray-500">
                ※ ΛはLLMではなく、事前定義ルールで確定します（実行時の人介在しません）
              </p>
            </>
          )}
        </LayerSection>

        {/* Ǝ */}
        <LayerSection
          id="section-t"
          visible={visible["section-t"]}
          className="relative overflow-hidden"
          style={{
            backgroundColor: SECTION_STYLE.T.bg,
            borderLeft: `6px solid ${SECTION_STYLE.T.bar}`,
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            ...(traceGlow(isPass)),
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 35%, rgba(255,255,255,0) 60%)",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: 1,
              pointerEvents: "none",
              background: "rgba(255,255,255,0.35)",
            }}
          />

          <div style={{ position: "relative" }}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                Ǝ – Trace｜判断理由と責任の記録
              </h2>
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
                  <div className="mt-1 text-gray-700">
                    Ǝトレースが存在する限り、このAIはブラックボックスになりません。
                  </div>
                </div>

                <p className="mt-3 text-xs text-gray-500">
                  ※ 「説明」ではなく「再生可能な記録（Trace）」として残します
                </p>
              </>
            )}
          </div>
        </LayerSection>

        {/* Continue to Action Loop (Presentation-friendly) */}
        <div className="pt-2">
          <button
            onClick={scrollToAction}
            disabled={!result} // 生成後にだけ進める（プレゼンも安全）
            className="w-full rounded-xl border px-4 py-3 text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            style={{
              backgroundColor: "#FFFFFF",
              borderColor: "rgba(0,0,0,0.10)",
              color: "rgba(0,0,0,0.80)",
            }}
          >
            Continue to Action Loop →
          </button>

          <div className="mt-2 text-xs text-gray-500">
            ※ 本来は自動遷移可能ですが、プレゼンのため手動で進みます
          </div>
        </div>

        {/* Action Loop (same page, scroll) */}
        {showAction && (
          <div ref={actionRef} className="space-y-6 pt-10">
            {/* Header for Action Loop */}
            <section className="rounded-xl border p-6 bg-white">
              <div className="text-xs text-gray-500">Action Loop</div>
              <div className="text-lg font-semibold">Ea → Λa → Ǝa → Va</div>
              <div className="mt-2 text-sm text-gray-600">
                ※ ここで担当者が「現実への拘束（コミット）」を確定します
              </div>

              <button
                onClick={scrollToConscious}
                className="mt-4 text-sm text-gray-600 hover:text-gray-900"
              >
                ← Back to Conscious Loop
              </button>
            </section>

            {/* Ǝc (read-only recap) */}
            <section className="rounded-xl border p-6 bg-white">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-700">
                  Ǝc — Trace（read-only）
                </div>
                <div className="text-xs text-gray-500">Recommendation</div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-gray-600">推奨：</span>
                <span className="rounded-full border px-3 py-1 text-xs font-semibold">
                  {recommendationJP}
                </span>
                <span className="text-xs text-gray-400">
                  ※ここではまだ実行は確定していません
                </span>
              </div>

              <div className="mt-3 text-sm text-gray-700">
                {result?.Trace?.reason ?? "—"}
              </div>

              {result?.Trace?.actions?.length ? (
                <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
                  {result.Trace.actions.slice(0, 3).map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 text-xs text-gray-500">
                Trace ID: {result?.meta?.traceId ?? "—"}
              </div>
            </section>

            {/* Λa — Officer Commit */}
            <section className="rounded-xl border p-6 bg-white">
              <div className="text-sm font-semibold text-gray-700">
                Λa — Officer Commit
              </div>
              <div className="mt-1 text-xs text-gray-500">
                コミット：承認（Approve） / 差戻し（Review）
 / （Stop / Emergency）

              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                {/* 実行確定 → 学習A（青） */}
                <button
                  onClick={() => setActionPath("LEARNING_A")}
                  className="rounded-xl px-4 py-2 text-sm font-semibold"
                  style={{ backgroundColor: "rgba(9,104,255,0.10)", color: "#1E3A8A" }}
                >
                  実行確定
                </button>

                {/* 保留 → 学習B（紫） */}
                <button
                  onClick={() => setActionPath("LEARNING_B")}
                  className="rounded-xl px-4 py-2 text-sm font-semibold"
                  style={{
                    backgroundColor: "rgba(184,51,245,0.10)",
                    color: "#B833F5",
                  }}
                >
                  保留
                </button>

                {/* 拒否 → 緊急（赤） */}
                <button
                  onClick={() => setActionPath("EMERGENCY")}
                  className="rounded-xl px-4 py-2 text-sm font-semibold"
                  style={{ backgroundColor: "rgba(255,21,0,0.10)", color: "#DC2626" }}
                >
                  拒否
                </button>
              </div>

              <div className="mt-4">
                <label className="block text-xs text-gray-500">Commit note（任意）</label>
                <input
                  value={commitNote}
                  onChange={(e) => setCommitNote(e.target.value)}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
                  placeholder="e.g., Approved under policy / Under review / Policy violation"
                />
              </div>
            </section>

            {/* 押した後だけ：経路カードを1枚表示 */}
            {actionPath && (
              <section className="rounded-xl border p-6 bg-white">
                {actionPath === "EMERGENCY" && (
                  <div
                    className="rounded-xl p-4"
                    style={{ backgroundColor: "rgba(255,21,0,0.08)" }}
                  >
                    <div className="text-sm font-semibold" style={{ color: "#DC2626" }}>
                      Emergency Path Activated
                    </div>
                    <div className="mt-1 text-xs text-gray-600">緊急経路（安全遮断）</div>
                    <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
                      <li>重大逸脱・権限外・不可逆リスク超過を検知</li>
                      <li>即時停止（拒否確定）</li>
                      <li>意識ループ（Ec）へフィードバック</li>
                    </ul>
                  </div>
                )}

                {actionPath === "LEARNING_A" && (
                  <div
                    className="rounded-xl p-4"
                    style={{ backgroundColor: "rgba(9,104,255,0.08)" }}
                  >
                    <div className="text-sm font-semibold" style={{ color: "#1E3A8A" }}>
                      Learning Path A Activated
                    </div>
                    <div className="mt-1 text-xs text-gray-600">学習A（成功強化）</div>
                    <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
                      <li>成功条件（余裕・成立要因）を固定</li>
                      <li>次回判断を迅速化（Ec'へフィードバック）</li>
                      <li>将来候補（Va）を生成して強化</li>
                    </ul>
                  </div>
                )}

                {actionPath === "LEARNING_B" && (
                  <div
                    className="rounded-xl p-4"
                    style={{ backgroundColor: "rgba(184,51,245,0.08)" }}
                  >
                    <div className="text-sm font-semibold" style={{ color: "#B833F5" }}>
                      Learning Path B Activated
                    </div>
                    <div className="mt-1 text-xs text-gray-600">学習B（前提再設計）</div>
                    <ul className="mt-3 list-disc pl-5 text-sm text-gray-700 space-y-1">
                      <li>条件不足・構造誤差を固定</li>
                      <li>代替案（Va）を生成</li>
                      <li>候補空間を更新（Vc'へ統合）</li>
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* Ǝa — Commit Trace（簡易） */}
            {actionPath && (
              <section className="rounded-xl border p-6 bg-white">
                <div className="text-sm font-semibold text-gray-700">Ǝa — Commit Trace</div>

                <pre className="mt-3 rounded-lg bg-gray-50 p-4 text-xs text-gray-800 overflow-x-auto whitespace-pre-wrap">
{JSON.stringify(
  {
    commit: {
      officerId: "officer_demo",
      action:
        actionPath === "LEARNING_A"
          ? "承認（Approve）"
          : actionPath === "LEARNING_B"
          ? "差戻し（Review）"
          : "停止（Stop / Emergency）",
      note: commitNote || "",
      committedAt: new Date().toISOString(),
      linkedTraceId: result?.meta?.traceId ?? "—",
    },
    // Vaは最小表現：将来候補の方向だけを示す
    Va:
      actionPath === "LEARNING_A"
        ? "Ec'へ（成功条件の強化）"
        : actionPath === "LEARNING_B"
        ? "Vc'へ（前提修正・候補統合）"
        : "Ecへ（緊急停止・再入力）",
  },
  null,
  2
)}
                </pre>
              </section>
            )}
          </div>
        )}

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
          backgroundColor: "#FF1500",
          borderColor: "#FF1500",
          color: "#FFFFFF",
        }
      : tone === "good"
      ? {
          backgroundColor: "#0968FF",
          borderColor: "#0968FF",
          color: "#FFFFFF",
        }
      : {
          backgroundColor: "#FFFFFF",
          borderColor: "#E5E7EB",
          color: "#111827",
        };

  return (
    <div className="rounded-lg border p-3" style={styles} title={hint ?? ""}>
      <div className="text-xs font-semibold" style={{ color: styles.color }}>
        {label}
      </div>

      <div className="mt-1 font-bold text-base" style={{ color: styles.color }}>
        {value}
      </div>

      {hint && (
        <div className="mt-1 text-[11px]" style={{ color: styles.color }}>
          ⓘ 式/根拠（hover）
        </div>
      )}
    </div>
  );
}

function HeadroomBar({
  label,
  value,
  unit,
  color,
  warnColor,
}: {
  label: string;
  value: number;
  unit: string;
  color: string;
  warnColor: string;
}) {
  const ok = value >= 0;
  const abs = Math.min(100, Math.abs(value));
  const w = `${abs}%`;

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-700">{label}</div>
        <div
          className="text-xs font-semibold"
          style={{ color: ok ? color : warnColor }}
        >
          {round1(value)}
          {unit}
        </div>
      </div>

      <div className="mt-2 h-2 w-full rounded-full bg-gray-200 overflow-hidden">
        <div
          className="h-2 rounded-full"
          style={{ width: w, backgroundColor: ok ? color : warnColor }}
        />
      </div>

      <div className="mt-1 text-[11px] text-gray-500">{ok ? "余裕" : "不足/超過"}</div>
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

function FlowStepper({
  phase,
  activeStep,
  onStepClick,
  decision,
}: {
  phase: "idle" | "generating" | "done";
  activeStep: StepKey;
  onStepClick: (k: StepKey) => void;
  decision: "HOLD" | "PASS" | null;
}) {
  const steps: { key: StepKey; label: string; color: string }[] = [
    { key: "E", label: "Ec – Origin", color: "#FF4500" },
    { key: "V", label: "Vc – Vision", color: "#1E3A8A" },
    { key: "L", label: "Λc – Choice", color: "#84CC16" },
    { key: "T", label: "Ǝc – Trace", color: "#B833F5" },
  ];

  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (phase !== "generating") return;
    setIdx(0);
    const t = setInterval(() => setIdx((v) => (v + 1) % steps.length), 500);
    return () => clearInterval(t);
  }, [phase, steps.length]);

  const defaultActive: StepKey =
    phase === "idle" ? "E" : phase === "done" ? "T" : steps[idx].key;
  const showActive: StepKey = phase === "generating" ? defaultActive : activeStep;

  return (
    <div className="mt-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((s, i) => {
          const isActive = s.key === showActive;

          const isStrong =
            decision === "HOLD"
              ? s.key === "L" || s.key === "T"
              : decision === "PASS"
              ? s.key === "T"
              : false;

          const style: React.CSSProperties = isStrong
            ? {
                backgroundColor: s.color,
                color: "#fff",
                borderColor: s.color,
                boxShadow: `0 0 18px ${s.color}`,
                transform: "scale(1.05)",
              }
            : isActive
            ? { backgroundColor: s.color, color: "#fff", borderColor: s.color }
            : { backgroundColor: "transparent", color: s.color, borderColor: s.color };

          return (
            <React.Fragment key={s.key}>
              <span
                onClick={() => onStepClick(s.key)}
                className="cursor-pointer rounded-full px-2 py-1 transition-all border select-none"
                style={style}
              >
                {s.label}
              </span>

              {i < steps.length - 1 && <span style={{ color: "#9CA3AF" }}>→</span>}
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

function LayerSection({
  id,
  visible,
  children,
  style,
  className = "",
}: {
  id: string;
  visible: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`rounded-xl border p-6 transition-all duration-500 ease-out ${className}`}
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0px)" : "translateY(10px)",
      }}
    >
      {children}
    </section>
  );
}
