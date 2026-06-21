import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Share2,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Search,
  MessageSquare,
} from "lucide-react";
import SwishLogo from "../components/SwishLogo";
import { shareCollection } from "../lib/share";

function Field({ label, children, required }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold text-[#6B6B8D] uppercase tracking-wider">
        {label}
        {required && <span className="text-[#FF8C3B] ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function HomePage() {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    target_amount: "",
    swish_number: "",
    suggested_amount: "",
    require_proof: false,
    pin: "",
  });
  const [showPin, setShowPin] = useState(false);
  const [usePinRecovery, setUsePinRecovery] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryData, setRecoveryData] = useState({
    swish_number: "",
    pin: "",
  });
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryMethod, setRecoveryMethod] = useState("pin");
  const [smsStep, setSmsStep] = useState(1);
  const [smsData, setSmsData] = useState({ swish_number: "", code: "" });
  const [smsError, setSmsError] = useState("");
  const [smsResults, setSmsResults] = useState(null);
  const [created, setCreated] = useState(null);
  const [shareSuccess, setShareSuccess] = useState(false);

  const createCollection = useMutation({
    mutationFn: async (data) => {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Kunde inte skapa insamlingen");
      return res.json();
    },
    onSuccess: (data) => setCreated(data),
  });

  const recoverCollection = useMutation({
    mutationFn: async (data) => {
      const res = await fetch("/api/collections/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Återställning misslyckades");
      }
      return res.json();
    },
    onSuccess: (data) => {
      window.location.href = `/c/${data.id}/admin?token=${data.admin_token}`;
    },
    onError: (err) => setRecoveryError(err.message),
  });

  const requestSmsCode = useMutation({
    mutationFn: async (swish_number) => {
      const res = await fetch("/api/collections/recover/sms/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swish_number }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Kunde inte skicka kod");
      }
      return res.json();
    },
    onSuccess: () => {
      setSmsError("");
      setSmsStep(2);
    },
    onError: (err) => setSmsError(err.message),
  });

  const verifySmsCode = useMutation({
    mutationFn: async (data) => {
      const res = await fetch("/api/collections/recover/sms/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Verifiering misslyckades");
      }
      return res.json();
    },
    onSuccess: (data) => {
      const cols = data.collections || [];
      if (cols.length === 1) {
        window.location.href = `/c/${cols[0].id}/admin?token=${cols[0].admin_token}`;
      } else {
        setSmsResults(cols);
      }
    },
    onError: (err) => setSmsError(err.message),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...formData };
    if (!usePinRecovery) payload.pin = "";
    createCollection.mutate(payload);
  };

  const handleShare = async () => {
    if (!created) return;
    const ok = await shareCollection({
      url: `${window.location.origin}/c/${created.id}`,
      title: created.title,
      targetAmount: created.target_amount,
      suggestedAmount: created.suggested_amount,
    });
    if (ok) {
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 3000);
    }
  };

  if (created) {
    const adminUrl = `${window.location.origin}/c/${created.id}/admin?token=${created.admin_token}`;
    const publicUrl = `${window.location.origin}/c/${created.id}`;
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#f5f0ff] to-[#fff8f0] flex flex-col items-center justify-center px-4 py-12 font-inter">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <div
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg"
              style={{
                background:
                  "linear-gradient(135deg, #5B3FA8 0%, #0099CC 50%, #FF8C3B 100%)",
              }}
            >
              <Check size={32} color="white" />
            </div>
            <h1 className="text-2xl font-bold text-[#1A1A2E]">
              Insamlingen är skapad!
            </h1>
            <p className="text-[#6B6B8D] mt-1 text-sm">
              Dela länken med dina vänner för att börja samla in.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-[#E8E0FF] shadow-sm p-6 space-y-5">
            <div className="space-y-1">
              <p className="text-xs font-bold text-[#9B9BB5] uppercase tracking-wider">
                Offentlig länk – dela denna
              </p>
              <div className="bg-[#F8F6FF] rounded-xl px-4 py-3 border border-[#E8E0FF]">
                <span className="text-sm text-[#1A1A2E] break-all font-mono">
                  {publicUrl}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-bold text-[#9B9BB5] uppercase tracking-wider flex items-center gap-1.5">
                <Lock size={11} /> Admin-länk (spara denna!)
              </p>
              <div className="bg-[#FFF8F0] rounded-xl px-4 py-3 border border-[#FFD4A8]">
                <span className="text-xs text-[#1A1A2E] break-all font-mono">
                  {adminUrl}
                </span>
              </div>
              <p className="text-xs text-[#C4A882]">
                ⚠️ Ger full adminbehörighet. Dela inte offentligt.
              </p>
            </div>
            <button
              onClick={handleShare}
              className="w-full py-3.5 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 shadow-md hover:opacity-90 transition-all"
              style={{
                background:
                  "linear-gradient(135deg, #5B3FA8 0%, #0099CC 50%, #FF8C3B 100%)",
              }}
            >
              <Share2 size={18} />
              {shareSuccess ? "✓ Delat!" : "Dela insamlingen"}
            </button>
            <button
              onClick={() =>
                (window.location.href = `/c/${created.id}/admin?token=${created.admin_token}`)
              }
              className="w-full py-3 rounded-xl font-semibold text-[#5B3FA8] text-sm border border-[#E8E0FF] hover:bg-[#F8F6FF] transition-colors"
            >
              Gå till adminpanel →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f5f0ff] to-[#fff8f0] font-inter">
      <nav className="bg-white/90 backdrop-blur border-b border-[#E8E0FF] sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SwishLogo size={34} />
            <span className="font-bold text-lg tracking-tight text-[#1A1A2E]">
              Swish Insamling
            </span>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 md:py-16">
        <div className="grid md:grid-cols-2 gap-10 items-start">
          {/* Hero */}
          <div className="space-y-6 md:pt-6">
            <div
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold text-white shadow-sm"
              style={{
                background: "linear-gradient(135deg, #5B3FA8, #0099CC)",
              }}
            >
              Snabbt · Enkelt · Gratis
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold text-[#1A1A2E] leading-[1.1] tracking-tight">
              Samla in pengar
              <br />
              <span
                style={{
                  background:
                    "linear-gradient(90deg, #5B3FA8, #0099CC, #FF8C3B)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                med Swish
              </span>
            </h1>
            <p className="text-[#6B6B8D] text-lg leading-relaxed max-w-sm">
              Skapa en insamlingssida på sekunder. Dela länken. Låt alla swisha
              direkt.
            </p>
            <ul className="space-y-3 pt-2">
              {[
                "Inget konto krävs för att bidra",
                "Automatisk referenskod per betalare",
                "Admin-panel för att bekräfta betalningar",
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-3 text-sm text-[#4B4B6D]"
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      background: "linear-gradient(135deg, #5B3FA8, #0099CC)",
                    }}
                  >
                    <Check size={11} color="white" />
                  </div>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Form */}
          <div className="bg-white rounded-2xl border border-[#E8E0FF] shadow-md p-7">
            <h2 className="text-xl font-bold text-[#1A1A2E] mb-1">
              Skapa insamling
            </h2>
            <p className="text-sm text-[#9B9BB5] mb-6">
              Fyll i uppgifterna nedan och dela länken.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Titel" required>
                <input
                  required
                  type="text"
                  placeholder="T.ex. Present till Anna"
                  className="swish-input"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                />
              </Field>

              <Field label="Beskrivning (valfritt)">
                <textarea
                  placeholder="Vad samlar ni in till?"
                  rows={2}
                  className="swish-input resize-none"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Swish-nummer" required>
                  <input
                    required
                    type="tel"
                    placeholder="070 000 00 00"
                    className="swish-input"
                    value={formData.swish_number}
                    onChange={(e) =>
                      setFormData({ ...formData, swish_number: e.target.value })
                    }
                  />
                </Field>
                <Field label="Målbelopp (kr)">
                  <input
                    type="number"
                    placeholder="T.ex. 500"
                    className="swish-input"
                    value={formData.target_amount}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        target_amount: e.target.value,
                      })
                    }
                  />
                </Field>
              </div>

              <Field label="Rekommenderat belopp (kr)">
                <input
                  type="number"
                  placeholder="T.ex. 50"
                  className="swish-input"
                  value={formData.suggested_amount}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      suggested_amount: e.target.value,
                    })
                  }
                />
              </Field>

              <label className="flex items-start gap-3 p-3 rounded-xl bg-[#F8F6FF] border border-[#E8E0FF] cursor-pointer hover:bg-[#F0EBFF] transition-colors">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[#5B3FA8]"
                  checked={formData.require_proof}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      require_proof: e.target.checked,
                    })
                  }
                />
                <div>
                  <p className="text-sm font-bold text-[#1A1A2E]">
                    Kräv betalningsbevis
                  </p>
                  <p className="text-xs text-[#9B9BB5] mt-0.5">
                    Betalaren uppmanas ta skärmdump och skicka via SMS.
                  </p>
                </div>
              </label>

              <div className="border border-[#E8E0FF] rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setUsePinRecovery(!usePinRecovery)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-[#5B3FA8] hover:bg-[#F8F6FF] transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Lock size={14} />
                    Återhämtnings-PIN (valfritt)
                  </span>
                  <ChevronDown
                    size={16}
                    className={`transition-transform duration-200 ${usePinRecovery ? "rotate-180" : ""}`}
                  />
                </button>
                {usePinRecovery && (
                  <div className="px-4 pb-4 pt-3 space-y-3 border-t border-[#E8E0FF] bg-[#FDFCFF]">
                    <div className="bg-[#F0EBFF] rounded-lg p-3 text-xs text-[#5B3FA8] leading-relaxed space-y-1.5">
                      <p>
                        <strong>Varför?</strong> Om du tappar admin-länken kan
                        du återfå åtkomst med ditt Swish-nummer + denna PIN.
                      </p>
                      <p className="text-[#9B9BB5]">
                        💡{" "}
                        <em>
                          Kort insamling på 1–2 dagar? Hoppa över detta och
                          spara bara admin-länken du får efteråt.
                        </em>
                      </p>
                    </div>
                    <div className="relative">
                      <input
                        type={showPin ? "text" : "password"}
                        placeholder="4–6 siffror"
                        maxLength={6}
                        className="swish-input pr-10"
                        value={formData.pin}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            pin: e.target.value.replace(/\D/g, ""),
                          })
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setShowPin(!showPin)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9B9BB5]"
                      >
                        {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {createCollection.isError && (
                <p className="text-sm text-red-500">
                  {createCollection.error?.message}
                </p>
              )}

              <button
                type="submit"
                disabled={createCollection.isPending}
                className="w-full py-3.5 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 shadow-md hover:opacity-90 transition-all disabled:opacity-50 mt-1"
                style={{
                  background:
                    "linear-gradient(135deg, #5B3FA8 0%, #0099CC 50%, #FF8C3B 100%)",
                }}
              >
                {createCollection.isPending ? (
                  "Skapar..."
                ) : (
                  <>
                    <span>Skapa insamling</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Recovery Section */}
        <div className="mt-10 max-w-md mx-auto">
          <button
            onClick={() => setShowRecovery(!showRecovery)}
            className="w-full flex items-center justify-center gap-2 text-sm font-bold text-[#5B3FA8] py-3 px-5 rounded-xl border border-[#E8E0FF] bg-white hover:bg-[#F8F6FF] transition-colors shadow-sm"
          >
            <Search size={15} />
            Tappat din admin-länk?
            <ChevronDown
              size={15}
              className={`transition-transform duration-200 ${showRecovery ? "rotate-180" : ""}`}
            />
          </button>

          {showRecovery && (
            <div className="mt-3 bg-white rounded-2xl border border-[#E8E0FF] shadow-sm p-5 space-y-4">
              <div className="flex gap-2">
                {[
                  { key: "pin", label: "Med PIN" },
                  { key: "sms", label: "Med SMS" },
                ].map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => {
                      setRecoveryMethod(m.key);
                      setRecoveryError("");
                      setSmsError("");
                    }}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${
                      recoveryMethod === m.key
                        ? "bg-[#F0EBFF] text-[#5B3FA8] border-[#D9CCFF]"
                        : "bg-white text-[#9B9BB5] border-[#E8E0FF] hover:bg-[#F8F6FF]"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {recoveryMethod === "pin" && (
                <>
                  <p className="text-sm text-[#6B6B8D]">
                    Ange ditt Swish-nummer och PIN-koden du valde vid skapandet.
                  </p>
                  <Field label="Ditt Swish-nummer">
                    <input
                      type="tel"
                      placeholder="070 000 00 00"
                      className="swish-input"
                      value={recoveryData.swish_number}
                      onChange={(e) =>
                        setRecoveryData({
                          ...recoveryData,
                          swish_number: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="PIN-kod">
                    <input
                      type="password"
                      placeholder="4–6 siffror"
                      className="swish-input"
                      value={recoveryData.pin}
                      onChange={(e) =>
                        setRecoveryData({ ...recoveryData, pin: e.target.value })
                      }
                    />
                  </Field>
                  {recoveryError && (
                    <p className="text-sm text-red-500">{recoveryError}</p>
                  )}
                  <button
                    onClick={() => {
                      setRecoveryError("");
                      recoverCollection.mutate(recoveryData);
                    }}
                    disabled={
                      recoverCollection.isPending ||
                      !recoveryData.swish_number ||
                      !recoveryData.pin
                    }
                    className="w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50 hover:opacity-90 transition-all"
                    style={{
                      background: "linear-gradient(135deg, #5B3FA8, #0099CC)",
                    }}
                  >
                    {recoverCollection.isPending
                      ? "Söker..."
                      : "Hitta min insamling →"}
                  </button>
                </>
              )}

              {recoveryMethod === "sms" && (
                <>
                  {smsResults ? (
                    <div className="space-y-3">
                      <p className="text-sm font-bold text-[#1A1A2E]">
                        Dina insamlingar
                      </p>
                      {smsResults.length === 0 ? (
                        <p className="text-sm text-[#9B9BB5]">
                          Inga aktiva insamlingar hittades på detta nummer.
                        </p>
                      ) : (
                        smsResults.map((col) => (
                          <a
                            key={col.id}
                            href={`/c/${col.id}/admin?token=${col.admin_token}`}
                            className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[#E8E0FF] hover:bg-[#F8F6FF] transition-colors"
                          >
                            <span className="text-sm font-semibold text-[#1A1A2E] truncate">
                              {col.title}
                            </span>
                            <ArrowRight
                              size={15}
                              className="text-[#5B3FA8] shrink-0"
                            />
                          </a>
                        ))
                      )}
                    </div>
                  ) : smsStep === 1 ? (
                    <>
                      <p className="text-sm text-[#6B6B8D]">
                        Vi skickar en engångskod via SMS till ditt Swish-nummer.
                      </p>
                      <Field label="Ditt Swish-nummer">
                        <input
                          type="tel"
                          placeholder="070 000 00 00"
                          className="swish-input"
                          value={smsData.swish_number}
                          onChange={(e) =>
                            setSmsData({
                              ...smsData,
                              swish_number: e.target.value,
                            })
                          }
                        />
                      </Field>
                      {smsError && (
                        <p className="text-sm text-red-500">{smsError}</p>
                      )}
                      <button
                        onClick={() => {
                          setSmsError("");
                          requestSmsCode.mutate(smsData.swish_number);
                        }}
                        disabled={
                          requestSmsCode.isPending || !smsData.swish_number
                        }
                        className="w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50 hover:opacity-90 transition-all flex items-center justify-center gap-2"
                        style={{
                          background:
                            "linear-gradient(135deg, #5B3FA8, #0099CC)",
                        }}
                      >
                        <MessageSquare size={15} />
                        {requestSmsCode.isPending ? "Skickar..." : "Skicka kod"}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-[#6B6B8D]">
                        Ange den 6-siffriga koden vi skickade till{" "}
                        {smsData.swish_number}.
                      </p>
                      <Field label="Kod">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder="000000"
                          className="swish-input tracking-widest"
                          value={smsData.code}
                          onChange={(e) =>
                            setSmsData({
                              ...smsData,
                              code: e.target.value.replace(/\D/g, ""),
                            })
                          }
                        />
                      </Field>
                      {smsError && (
                        <p className="text-sm text-red-500">{smsError}</p>
                      )}
                      <button
                        onClick={() => {
                          setSmsError("");
                          verifySmsCode.mutate(smsData);
                        }}
                        disabled={
                          verifySmsCode.isPending || smsData.code.length < 6
                        }
                        className="w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-50 hover:opacity-90 transition-all"
                        style={{
                          background:
                            "linear-gradient(135deg, #5B3FA8, #0099CC)",
                        }}
                      >
                        {verifySmsCode.isPending
                          ? "Verifierar..."
                          : "Verifiera kod →"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSmsStep(1);
                          setSmsData({ ...smsData, code: "" });
                          setSmsError("");
                        }}
                        className="w-full text-xs font-semibold text-[#9B9BB5] hover:text-[#5B3FA8]"
                      >
                        Använd ett annat nummer
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-[#E8E0FF] bg-white mt-16 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <SwishLogo size={24} />
            <span className="text-sm text-[#9B9BB5] font-medium">
              © 2026 Swish Insamling
            </span>
          </div>
          <p className="text-xs text-[#C4C4D4] text-center">
            Ej kopplat till Swish AB. Betalningar sker direkt via din Swish-app.
          </p>
        </div>
      </footer>
    </div>
  );
}
