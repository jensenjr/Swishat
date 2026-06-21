import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CheckCircle2,
  Users,
  ArrowRight,
  Camera,
  Share2,
  MessageSquare,
  Megaphone,
} from "lucide-react";

function SwishLogo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <defs>
        <linearGradient id="sg2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5B3FA8" />
          <stop offset="45%" stopColor="#0099CC" />
          <stop offset="100%" stopColor="#FF8C3B" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="10" fill="url(#sg2)" />
      <path
        d="M9 22C9 22 12 14 18 14C21 14 22.5 16 24 16C26 16 27 14 27 14"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M9 18C9 18 12 10 18 10C21 10 22.5 12 24 12C26 12 27 10 27 10"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.45"
      />
    </svg>
  );
}

export default function CollectionPublicPage() {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState(1);
  const [contribution, setContribution] = useState(null);
  const [hasPressedPay, setHasPressedPay] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    const parts = window.location.pathname.split("/");
    setId(parts[2]);
    setOrigin(window.location.origin);
  }, []);

  const {
    data: collection,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["collection", id],
    queryFn: async () => {
      const res = await fetch(`/api/collections/${id}`);
      if (!res.ok) throw new Error("Insamlingen hittades inte");
      return res.json();
    },
    enabled: !!id,
    refetchInterval: 30000,
  });

  const createContribution = useMutation({
    mutationFn: async (data) => {
      const res = await fetch("/api/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, collection_id: id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Misslyckades");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setContribution(data);
      setStep(2);
    },
  });

  const handleShare = async () => {
    const url = `${origin}/c/${id}`;
    const title = collection?.title || "Insamling";
    const parts = [`Här är länken till insamlingen "${title}"`];
    if (collection?.target_amount)
      parts.push(`Mål: ${collection.target_amount} kr`);
    if (collection?.suggested_amount)
      parts.push(`Rekommenderat belopp: ${collection.suggested_amount} kr`);
    parts.push(url);
    const text = parts.join("\n");
    try {
      if (navigator.share) await navigator.share({ title, text, url });
      else navigator.clipboard.writeText(text);
    } catch (_) {}
  };

  const handleSendProof = () => {
    const tel = collection?.swish_number?.replace(/\s/g, "");
    const msg = encodeURIComponent(
      `Hej! Jag har betalat. Här är mitt bevis och min referenskod: ${contribution?.reference_code}`,
    );
    const isApple = /iPhone|iPad/i.test(navigator.userAgent);
    const url = isApple ? `sms:${tel}&body=${msg}` : `sms:${tel}?body=${msg}`;
    window.open(url, "_blank");
  };

  const swishUrl =
    contribution && collection
      ? `swish://payment?data=${encodeURIComponent(
          JSON.stringify({
            version: 1,
            payee: { value: collection.swish_number.replace(/\s/g, "") },
            amount: { value: parseFloat(contribution.amount) || 0, editable: false },
            message: { value: contribution.reference_code, editable: false },
          }),
        )}`
      : "";

  if (!id || isLoading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f5f0ff] to-[#fff8f0]">
        <div className="flex flex-col items-center gap-3">
          <SwishLogo size={40} />
          <p className="text-[#9B9BB5] text-sm animate-pulse">
            Laddar insamling…
          </p>
        </div>
      </div>
    );

  if (error || !collection)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f5f0ff] to-[#fff8f0]">
        <div className="text-center space-y-2 px-4">
          <p className="text-[#1A1A2E] font-bold text-lg">
            Insamlingen hittades inte
          </p>
          <p className="text-sm text-[#9B9BB5]">
            Kontrollera länken och försök igen.
          </p>
        </div>
      </div>
    );

  if (!collection.is_active || collection.expiry?.isExpired) {
    const collected = Number(collection.stats?.total_collected || 0);
    const contributors = collection.stats?.verified_count || 0;
    const target = collection.target_amount
      ? Number(collection.target_amount)
      : null;
    const reached = target != null && collected >= target;
    const pct = target ? Math.min(100, Math.round((collected / target) * 100)) : null;
    const fmt = (n) => Number(n).toLocaleString("sv-SE");

    let summary;
    if (target == null) {
      summary = `Insamlingen är avslutad. Totalt insamlat: ${fmt(collected)} kr.`;
    } else if (reached) {
      summary = `Insamlingen stängdes efter att målet på ${fmt(target)} kr uppnåddes 🎉`;
    } else {
      summary = `Insamlingen stängdes innan målet på ${fmt(target)} kr nåddes – ${fmt(collected)} kr samlades in (${pct}% av målet).`;
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f5f0ff] to-[#fff8f0]">
        <div className="bg-white rounded-2xl border border-[#E8E0FF] p-8 max-w-sm mx-4 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-[#F0EBFF] flex items-center justify-center mx-auto text-2xl">
            {reached ? "🎉" : "🔒"}
          </div>
          <h2 className="font-extrabold text-[#1A1A2E] text-xl">
            Insamlingen är stängd
          </h2>
          <p className="text-sm text-[#6B6B8D] leading-relaxed">{summary}</p>

          <div className="bg-[#F8F6FF] border border-[#E8E0FF] rounded-xl p-4 space-y-3 text-left">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-bold text-[#9B9BB5] uppercase tracking-wider">
                Insamlat
              </span>
              <span className="text-lg font-extrabold text-[#1A1A2E]">
                {fmt(collected)} kr
                {target != null && (
                  <span className="text-sm font-medium text-[#9B9BB5]">
                    {" "}
                    / {fmt(target)} kr
                  </span>
                )}
              </span>
            </div>
            {target != null && (
              <div className="h-2 rounded-full bg-[#E8E0FF] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: reached
                      ? "linear-gradient(90deg, #16a34a, #4ade80)"
                      : "linear-gradient(90deg, #5B3FA8, #FF8C3B)",
                  }}
                />
              </div>
            )}
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-bold text-[#9B9BB5] uppercase tracking-wider">
                Bidragsgivare
              </span>
              <span className="text-sm font-bold text-[#1A1A2E]">
                {contributors} st
              </span>
            </div>
          </div>

          <p className="text-xs text-[#C4C4D4]">
            Denna insamling tar inte längre emot bidrag.
          </p>
        </div>
      </div>
    );
  }

  const progress = collection.target_amount
    ? Math.min(
        (collection.stats.total_collected / collection.target_amount) * 100,
        100,
      )
    : null;

  const { daysUntilExpiry, isNearHardCap } = collection.expiry || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f5f0ff] to-[#fff8f0] font-inter pb-24">
      <nav className="bg-white/90 backdrop-blur border-b border-[#E8E0FF] sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SwishLogo size={28} />
            <span className="font-bold text-[#1A1A2E] text-sm">
              Swish Insamling
            </span>
          </div>
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 text-xs font-bold text-[#5B3FA8] px-3 py-1.5 rounded-full border border-[#E8E0FF] hover:bg-[#F8F6FF] transition-colors"
          >
            <Share2 size={13} /> Dela
          </button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        {collection.cover_image && (
          <img
            src={collection.cover_image}
            alt={collection.title}
            className="w-full h-48 sm:h-60 object-cover rounded-2xl border border-[#E8E0FF] shadow-sm"
          />
        )}

        {/* Collection Header */}
        <div className="bg-white rounded-2xl border border-[#E8E0FF] shadow-sm p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-extrabold text-[#1A1A2E] leading-tight">
                {collection.title}
              </h1>
              {collection.description && (
                <p className="text-sm text-[#6B6B8D] mt-2 leading-relaxed">
                  {collection.description}
                </p>
              )}
            </div>
            {progress !== null && (
              <div className="relative w-20 h-20 shrink-0">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    fill="none"
                    stroke="#F0EBFF"
                    strokeWidth="7"
                  />
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    fill="none"
                    strokeWidth="7"
                    strokeLinecap="round"
                    stroke="url(#prog)"
                    strokeDasharray={`${2 * Math.PI * 34}`}
                    strokeDashoffset={`${2 * Math.PI * 34 * (1 - progress / 100)}`}
                  />
                  <defs>
                    <linearGradient id="prog" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#5B3FA8" />
                      <stop offset="100%" stopColor="#FF8C3B" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-extrabold text-[#1A1A2E]">
                    {Math.round(progress)}%
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mt-5 pt-5 border-t border-[#F0EBFF]">
            <div>
              <p className="text-xs font-bold text-[#9B9BB5] uppercase tracking-wider">
                Insamlat
              </p>
              <p className="text-xl font-extrabold text-[#1A1A2E] mt-0.5">
                {Number(collection.stats.total_collected).toLocaleString(
                  "sv-SE",
                )}{" "}
                kr
                {collection.target_amount && (
                  <span className="text-sm font-medium text-[#9B9BB5]">
                    {" "}
                    / {Number(collection.target_amount).toLocaleString("sv-SE")}{" "}
                    kr
                  </span>
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-[#9B9BB5] uppercase tracking-wider">
                Bidragsgivare
              </p>
              <p className="text-xl font-extrabold text-[#1A1A2E] mt-0.5 flex items-center gap-1.5">
                <Users size={18} className="text-[#9B9BB5]" />{" "}
                {collection.stats.total_count} st
              </p>
            </div>
          </div>

          {daysUntilExpiry !== undefined && daysUntilExpiry <= 7 && (
            <div
              className={`mt-4 text-xs font-semibold rounded-lg px-3 py-2 flex items-center gap-2 ${isNearHardCap ? "bg-red-50 text-red-600 border border-red-100" : "bg-orange-50 text-orange-700 border border-orange-100"}`}
            >
              ⏰{" "}
              {isNearHardCap
                ? `Stänger permanent om ${daysUntilExpiry} dag${daysUntilExpiry !== 1 ? "ar" : ""} (maxgräns nådd)`
                : `Aktiv i ${daysUntilExpiry} dag${daysUntilExpiry !== 1 ? "ar" : ""} till`}
            </div>
          )}
          {daysUntilExpiry !== undefined && daysUntilExpiry > 7 && (
            <p className="text-xs text-[#C4C4D4] mt-3">
              💚 Aktiv i {daysUntilExpiry} dagar till
            </p>
          )}
        </div>

        {/* Interaction Card */}
        <div className="bg-white rounded-2xl border border-[#E8E0FF] shadow-sm p-6">
          {step === 1 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createContribution.mutate({
                  name,
                  amount: parseFloat(amount) || undefined,
                });
              }}
              className="space-y-5"
            >
              <h2 className="text-lg font-extrabold text-[#1A1A2E]">
                Bidra till insamlingen
              </h2>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#6B6B8D] uppercase tracking-wider">
                  Ditt namn <span className="text-[#FF8C3B]">*</span>
                </label>
                <input
                  required
                  type="text"
                  placeholder="Förnamn Efternamn"
                  className="swish-input-pub"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#6B6B8D] uppercase tracking-wider">
                  Belopp (kr)
                </label>
                <input
                  type="number"
                  min="1"
                  placeholder={
                    collection.suggested_amount
                      ? `Förslag: ${collection.suggested_amount} kr`
                      : "T.ex. 100"
                  }
                  className="swish-input-pub"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              {createContribution.isError && (
                <p className="text-sm text-red-500">
                  {createContribution.error?.message}
                </p>
              )}
              <button
                type="submit"
                disabled={createContribution.isPending}
                className="w-full py-3.5 rounded-xl font-bold text-white flex items-center justify-center gap-2 shadow-md hover:opacity-90 transition-all disabled:opacity-50"
                style={{
                  background:
                    "linear-gradient(135deg, #5B3FA8 0%, #0099CC 50%, #FF8C3B 100%)",
                }}
              >
                {createContribution.isPending ? (
                  "Förbereder…"
                ) : (
                  <>
                    <span>Fortsätt till betalning</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          )}

          {step === 2 && contribution && (
            <div className="space-y-6 text-center">
              <div>
                <h2 className="text-xl font-extrabold text-[#1A1A2E]">
                  Redo att betala
                </h2>
                <p className="text-sm text-[#9B9BB5] mt-1">
                  Använd referenskoden nedan i Swish.
                </p>
              </div>

              {collection.require_proof && !hasPressedPay && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left space-y-1.5">
                  <p className="font-bold text-amber-700 text-sm flex items-center gap-2">
                    <Camera size={15} /> Viktigt – läs innan du swishar!
                  </p>
                  <p className="text-xs text-amber-600 leading-relaxed">
                    Organisatören kräver betalningsbevis.{" "}
                    <strong>Ta en skärmdump av kvittot i Swish</strong> innan du
                    lämnar appen – du behöver det efteråt.
                  </p>
                </div>
              )}

              <div className="bg-[#F8F6FF] border border-[#E8E0FF] rounded-xl p-6 space-y-2">
                <p className="text-xs font-bold text-[#9B9BB5] uppercase tracking-wider">
                  Referenskod
                </p>
                <p className="text-3xl font-extrabold tracking-widest text-[#1A1A2E] font-mono">
                  {contribution.reference_code}
                </p>
                <p className="text-xs text-[#C4C4D4]">
                  Koden är låst i Swish – ändra den inte.
                </p>
              </div>

              <div className="space-y-3">
                <a
                  href={swishUrl}
                  onClick={() => setHasPressedPay(true)}
                  className="w-full py-4 rounded-xl font-extrabold text-white text-base flex items-center justify-center gap-3 shadow-lg hover:opacity-90 transition-all"
                  style={{
                    background:
                      "linear-gradient(135deg, #5B3FA8 0%, #0099CC 50%, #FF8C3B 100%)",
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 36 36" fill="none">
                    <rect
                      width="36"
                      height="36"
                      rx="8"
                      fill="white"
                      opacity="0.2"
                    />
                    <path
                      d="M9 22C9 22 12 14 18 14C21 14 22.5 16 24 16C26 16 27 14 27 14"
                      stroke="white"
                      strokeWidth="3"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>
                  Öppna Swish och betala
                </a>
                {hasPressedPay && (
                  <button
                    onClick={() => setStep(3)}
                    className="w-full py-3 rounded-xl font-bold text-[#5B3FA8] text-sm border border-[#E8E0FF] hover:bg-[#F8F6FF] transition-colors"
                  >
                    Jag har betalat klart ✓
                  </button>
                )}
              </div>

              <div className="bg-[#F8F6FF] rounded-lg p-3 text-xs text-[#6B6B8D] text-left leading-relaxed">
                ℹ️ Din betalning markeras som{" "}
                <strong className="text-[#5B3FA8]">overifierad</strong> tills
                organisatören bekräftar i sin Swish-app.
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="py-8 text-center space-y-6">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                style={{
                  background: "linear-gradient(135deg, #5B3FA8, #0099CC)",
                }}
              >
                <CheckCircle2 size={32} color="white" />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-[#1A1A2E]">
                  Tack, {name}!
                </h2>
                <p className="text-sm text-[#9B9BB5] mt-1">
                  Ditt bidrag är registrerat och väntar på bekräftelse.
                </p>
              </div>

              {collection.require_proof && (
                <div className="bg-[#F8F6FF] border border-[#E8E0FF] rounded-xl p-5 space-y-3 text-left">
                  <p className="text-sm font-bold text-[#1A1A2E] flex items-center gap-2">
                    <Camera size={16} className="text-[#5B3FA8]" /> Skicka
                    betalningsbevis
                  </p>
                  <p className="text-xs text-[#6B6B8D] leading-relaxed">
                    Organisatören kräver ett bevis. Öppna SMS-appen med ett
                    förskrivet meddelande – bifoga din skärmdump från Swish och
                    skicka.
                  </p>
                  <button
                    onClick={handleSendProof}
                    className="w-full py-3 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all"
                    style={{
                      background: "linear-gradient(135deg, #5B3FA8, #0099CC)",
                    }}
                  >
                    <MessageSquare size={16} /> Öppna SMS med förskrivet
                    meddelande
                  </button>
                  <p className="text-xs text-[#C4C4D4] text-center">
                    Referenskoden är redan ifylld i meddelandet.
                  </p>
                </div>
              )}

              <button
                onClick={() => {
                  setStep(1);
                  setName("");
                  setAmount("");
                  setContribution(null);
                  setHasPressedPay(false);
                }}
                className="text-sm font-semibold text-[#5B3FA8] hover:underline"
              >
                Bidra igen
              </button>
            </div>
          )}
        </div>

        {/* Updates */}
        {collection.updates?.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#E8E0FF] shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-extrabold text-[#1A1A2E] flex items-center gap-2">
              <Megaphone size={18} className="text-[#5B3FA8]" /> Uppdateringar
            </h2>
            <div className="space-y-5">
              {collection.updates.map((u) => (
                <div key={u.id} className="border-l-2 border-[#E8E0FF] pl-4">
                  <p className="text-xs text-[#9B9BB5]">
                    {new Date(u.created_at).toLocaleDateString("sv-SE", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                  {u.title && (
                    <p className="text-sm font-bold text-[#1A1A2E] mt-0.5">
                      {u.title}
                    </p>
                  )}
                  <p className="text-sm text-[#6B6B8D] mt-1 leading-relaxed whitespace-pre-wrap">
                    {u.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Floating Share Button */}
      <div className="fixed bottom-6 right-4 z-30">
        <button
          onClick={handleShare}
          className="flex items-center gap-2 py-3 px-4 rounded-full font-bold text-white text-sm shadow-xl hover:opacity-90 transition-all"
          style={{ background: "linear-gradient(135deg, #5B3FA8, #FF8C3B)" }}
        >
          <Share2 size={16} /> Dela
        </button>
      </div>
    </div>
  );
}
