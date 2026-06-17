import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Trash2,
  Share2,
  ShieldAlert,
  Clock,
  RotateCcw,
  Users,
  TrendingUp,
  PlusCircle,
  X,
  History,
} from "lucide-react";

const AUDIT_LABELS = {
  "contribution.create_manual": "Manuell betalning tillagd",
  "contribution.update": "Bidrag uppdaterat",
  "contribution.delete": "Bidrag borttaget",
  "collection.extend": "Insamling förlängd",
  "collection.close": "Insamling stängd",
  "collection.reopen": "Insamling återöppnad",
};

function describeAudit(entry) {
  const label = AUDIT_LABELS[entry.action] || entry.action;
  const d = entry.detail || {};
  const bits = [];
  if (d.name) bits.push(d.name);
  if (d.status) bits.push(d.status === "verified" ? "verifierad" : "overifierad");
  if (d.amount != null && d.amount !== "")
    bits.push(`${Number(d.amount).toLocaleString("sv-SE")} kr`);
  if (d.reference_code) bits.push(d.reference_code);
  return { label, extra: bits.join(" · ") };
}

function SwishLogo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <defs>
        <linearGradient id="sg3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5B3FA8" />
          <stop offset="45%" stopColor="#0099CC" />
          <stop offset="100%" stopColor="#FF8C3B" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="10" fill="url(#sg3)" />
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

function ExpiryBanner({ expiry, onExtend, isExtending }) {
  if (!expiry) return null;
  const { daysUntilExpiry, daysUntilHardCap, isNearHardCap } = expiry;
  if (daysUntilExpiry > 7 && !isNearHardCap) return null;
  const isRed = daysUntilExpiry <= 2 || isNearHardCap;
  return (
    <div
      className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${isRed ? "bg-red-50 border-red-200 text-red-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}
    >
      <div className="flex items-center gap-2">
        <Clock size={16} className="shrink-0" />
        <div>
          {isNearHardCap ? (
            <p className="text-sm font-bold">
              Maxgränsen (30 dagar) nås om {daysUntilHardCap} dagar – kan inte
              förlängas mer.
            </p>
          ) : (
            <p className="text-sm font-bold">
              Insamlingen stängs om {daysUntilExpiry} dag
              {daysUntilExpiry !== 1 ? "ar" : ""}
            </p>
          )}
          {!isNearHardCap && (
            <p className="text-xs opacity-75 mt-0.5">
              Nya betalningar förlänger automatiskt med 7 dagar.
            </p>
          )}
        </div>
      </div>
      {!isNearHardCap && (
        <button
          onClick={onExtend}
          disabled={isExtending}
          className="shrink-0 px-4 py-2 rounded-lg font-bold text-sm bg-white border shadow-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
          style={{
            borderColor: isRed ? "#FCA5A5" : "#FCD34D",
            color: isRed ? "#DC2626" : "#D97706",
          }}
        >
          {isExtending ? "Förlänger…" : "Förläng med 14 dagar"}
        </button>
      )}
    </div>
  );
}

export default function AdminCollectionPage() {
  const [id, setId] = useState("");
  const [token, setToken] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [shareSuccess, setShareSuccess] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [manualForm, setManualForm] = useState({ name: "", amount: "", status: "verified" });
  const queryClient = useQueryClient();

  useEffect(() => {
    const parts = window.location.pathname.split("/");
    setId(parts[2]);
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token") || "");
  }, []);

  // Send the admin token in the Authorization header rather than the request
  // URL, so it never appears in server/proxy access logs. The token still
  // lives in the page URL (so the admin link can be bookmarked), but no API
  // request carries it as a query param.
  const api = (path, options = {}) =>
    fetch(path, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    });

  const {
    data: collection,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["collection-admin", id, token],
    queryFn: async () => {
      const res = await api(`/api/collections/${id}`);
      if (!res.ok) throw new Error("Obehörig");
      return res.json();
    },
    enabled: !!id && !!token,
    refetchInterval: 15000,
  });

  const updateContribution = useMutation({
    mutationFn: async ({ contributionId, status }) => {
      const res = await api(`/api/contributions/${contributionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Misslyckades");
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries(["collection-admin", id, token]),
  });

  const deleteContribution = useMutation({
    mutationFn: async (contributionId) => {
      const res = await api(`/api/contributions/${contributionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Misslyckades");
      return res.json();
    },
    onSuccess: () => {
      setDeleteConfirm(null);
      queryClient.invalidateQueries(["collection-admin", id, token]);
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (is_active) => {
      const res = await api(`/api/collections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active }),
      });
      if (!res.ok) throw new Error("Misslyckades");
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries(["collection-admin", id, token]),
  });

  const extendCollection = useMutation({
    mutationFn: async () => {
      const res = await api(`/api/collections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extend: true }),
      });
      if (!res.ok) throw new Error("Misslyckades");
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries(["collection-admin", id, token]),
  });

  const verifyAll = useMutation({
    mutationFn: async () => {
      const unverified = (collection?.contributions || []).filter(
        (c) => c.status === "unverified",
      );
      await Promise.all(
        unverified.map((c) =>
          api(`/api/contributions/${c.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "verified" }),
          }),
        ),
      );
    },
    onSuccess: () =>
      queryClient.invalidateQueries(["collection-admin", id, token]),
  });

  const addManualPayment = useMutation({
    mutationFn: async ({ name, amount, status }) => {
      const res = await api("/api/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collection_id: id,
          name,
          amount: amount ? parseFloat(amount) : undefined,
          status,
        }),
      });
      if (!res.ok) throw new Error("Misslyckades");
      return res.json();
    },
    onSuccess: () => {
      setManualForm({ name: "", amount: "", status: "verified" });
      setShowManual(false);
      queryClient.invalidateQueries(["collection-admin", id, token]);
    },
  });

  const handleShare = async () => {
    if (!id || typeof window === "undefined") return;
    const url = `${window.location.origin}/c/${id}`;
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
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 3000);
    } catch (_) {}
  };

  if (!id || isLoading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#f5f0ff] to-[#fff8f0]">
        <div className="flex flex-col items-center gap-3">
          <SwishLogo size={40} />
          <p className="text-[#9B9BB5] text-sm">Laddar adminpanel…</p>
        </div>
      </div>
    );

  if (error || !collection?.isAdmin)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[#f5f0ff] to-[#fff8f0] p-4 text-center">
        <div className="bg-red-50 text-red-500 p-4 rounded-full mb-4">
          <ShieldAlert size={32} />
        </div>
        <h1 className="text-xl font-bold text-[#1A1A2E]">Obehörig</h1>
        <p className="text-sm text-[#9B9BB5] max-w-xs mt-2">
          Du saknar behörighet. Kontrollera att du använder rätt admin-länk.
        </p>
      </div>
    );

  const filtered = (collection.contributions || []).filter(
    (c) => activeTab === "all" || c.status === activeTab,
  );
  const unverifiedCount = (collection.contributions || []).filter(
    (c) => c.status === "unverified",
  ).length;
  const verifiedCount = (collection.contributions || []).filter(
    (c) => c.status === "verified",
  ).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f5f0ff] to-[#fff8f0] font-inter">
      <nav className="bg-white/90 backdrop-blur border-b border-[#E8E0FF] sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <SwishLogo size={30} />
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#9B9BB5] uppercase tracking-wider">
                Adminpanel
              </p>
              <p className="font-bold text-[#1A1A2E] text-sm truncate">
                {collection.title}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`/c/${id}`}
              target="_blank"
              rel="noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-xs font-bold text-[#5B3FA8] px-3 py-1.5 rounded-full border border-[#E8E0FF] hover:bg-[#F8F6FF] transition-colors"
            >
              Publik sida →
            </a>
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 text-xs font-bold text-white px-4 py-2 rounded-full hover:opacity-90 transition-all"
              style={{
                background: "linear-gradient(135deg, #5B3FA8, #0099CC)",
              }}
            >
              <Share2 size={13} /> {shareSuccess ? "Delat! ✓" : "Dela"}
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <ExpiryBanner
          expiry={collection.expiry}
          onExtend={() => extendCollection.mutate()}
          isExtending={extendCollection.isPending}
        />

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl border border-[#E8E0FF] p-5">
            <p className="text-xs font-bold text-[#9B9BB5] uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <TrendingUp size={12} />
              Insamlat (verifierat)
            </p>
            <div className="flex items-end gap-2 flex-wrap">
              <span className="text-3xl font-extrabold text-[#1A1A2E]">
                {Number(collection.stats.total_collected).toLocaleString(
                  "sv-SE",
                )}{" "}
                kr
              </span>
              {collection.target_amount && (
                <span className="text-sm text-[#9B9BB5] mb-1">
                  / {Number(collection.target_amount).toLocaleString("sv-SE")}{" "}
                  kr
                </span>
              )}
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-[#E8E0FF] p-5">
            <p className="text-xs font-bold text-[#9B9BB5] uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Users size={12} />
              Bidragsgivare
            </p>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-extrabold text-[#1A1A2E]">
                {collection.stats.total_count}
              </span>
              <span className="text-sm text-[#9B9BB5] mb-1">
                {verifiedCount} verifierade
              </span>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-[#E8E0FF] p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-[#9B9BB5] uppercase tracking-wider">
                Status
              </p>
              <div
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${collection.is_active ? "bg-green-50 text-green-700 border border-green-100" : "bg-gray-100 text-gray-500 border border-gray-200"}`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${collection.is_active ? "bg-green-500" : "bg-gray-400"}`}
                />
                {collection.is_active ? "Aktiv" : "Stängd"}
              </div>
            </div>
            <button
              onClick={() => toggleActive.mutate(!collection.is_active)}
              disabled={toggleActive.isPending}
              className="mt-4 text-xs font-bold text-[#5B3FA8] hover:underline disabled:opacity-50"
            >
              {collection.is_active
                ? "Stäng insamlingen →"
                : "Öppna insamlingen igen →"}
            </button>
          </div>
        </div>

        {/* Manual payment */}
        {!showManual ? (
          <button
            onClick={() => setShowManual(true)}
            className="flex items-center gap-2 text-sm font-bold text-[#5B3FA8] px-4 py-2.5 rounded-xl border border-[#E8E0FF] bg-white hover:bg-[#F8F6FF] transition-colors shadow-sm w-fit"
          >
            <PlusCircle size={15} /> Lägg till manuell betalning
          </button>
        ) : (
          <div className="bg-white rounded-2xl border border-[#E8E0FF] shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#1A1A2E]">Manuell betalning</h3>
              <button onClick={() => setShowManual(false)} className="text-[#9B9BB5] hover:text-[#1A1A2E]">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 sm:col-span-1">
                <label className="text-xs font-bold text-[#6B6B8D] uppercase tracking-wider">
                  Namn <span className="text-[#FF8C3B]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Förnamn Efternamn"
                  className="swish-input"
                  value={manualForm.name}
                  onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#6B6B8D] uppercase tracking-wider">Belopp (kr)</label>
                <input
                  type="number"
                  placeholder="Valfritt"
                  className="swish-input"
                  value={manualForm.amount}
                  onChange={(e) => setManualForm({ ...manualForm, amount: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#6B6B8D] uppercase tracking-wider">Status</label>
                <div className="flex gap-2 pt-1">
                  {["verified", "unverified"].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setManualForm({ ...manualForm, status: s })}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${
                        manualForm.status === s
                          ? s === "verified"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-white text-[#9B9BB5] border-[#E8E0FF] hover:bg-[#F8F6FF]"
                      }`}
                    >
                      {s === "verified" ? "Verifierad" : "Overifierad"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {addManualPayment.isError && (
              <p className="text-sm text-red-500">Kunde inte lägga till betalningen.</p>
            )}
            <button
              onClick={() => {
                if (!manualForm.name.trim()) return;
                addManualPayment.mutate(manualForm);
              }}
              disabled={addManualPayment.isPending || !manualForm.name.trim()}
              className="px-5 py-2.5 rounded-xl font-bold text-white text-sm hover:opacity-90 transition-all disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #5B3FA8, #0099CC)" }}
            >
              {addManualPayment.isPending ? "Lägger till…" : "Lägg till betalning"}
            </button>
          </div>
        )}

        {/* Table */}
        <div className="bg-white rounded-2xl border border-[#E8E0FF] overflow-hidden shadow-sm">
          <div className="border-b border-[#E8E0FF] px-5 flex items-center justify-between flex-wrap gap-2 py-2">
            <div className="flex gap-1">
              {[
                {
                  key: "all",
                  label: `Alla (${collection.contributions?.length || 0})`,
                },
                {
                  key: "unverified",
                  label: `Overifierade (${unverifiedCount})`,
                },
                { key: "verified", label: `Verifierade (${verifiedCount})` },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${activeTab === tab.key ? "bg-[#F0EBFF] text-[#5B3FA8]" : "text-[#9B9BB5] hover:text-[#5B3FA8]"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {unverifiedCount > 0 && (
              <button
                onClick={() => verifyAll.mutate()}
                disabled={verifyAll.isPending}
                className="text-xs font-bold text-[#5B3FA8] px-3 py-1.5 rounded-lg border border-[#E8E0FF] hover:bg-[#F8F6FF] transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                <CheckCircle2 size={13} /> Verifiera alla
              </button>
            )}
          </div>

          {deleteConfirm && (
            <div className="mx-5 my-4 bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-sm text-red-700 font-semibold">
                Ta bort bidraget från <strong>{deleteConfirm.name}</strong>?
              </p>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="text-xs font-bold px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-100 transition-colors"
                >
                  Avbryt
                </button>
                <button
                  onClick={() => deleteContribution.mutate(deleteConfirm.id)}
                  disabled={deleteContribution.isPending}
                  className="text-xs font-bold px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {deleteContribution.isPending ? "Tar bort…" : "Ja, ta bort"}
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[580px]">
              <thead>
                <tr className="bg-[#FAFAFA] border-b border-[#F0EBFF]">
                  {[
                    "Bidragsgivare",
                    "Referenskod",
                    "Belopp",
                    "Status",
                    "Åtgärder",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-xs font-bold text-[#9B9BB5] uppercase tracking-wider last:text-right"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EBFF]">
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-12 text-center text-sm text-[#9B9BB5]"
                    >
                      Inga bidragsgivare i denna kategori.
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr
                      key={c.id}
                      className="hover:bg-[#FDFCFF] transition-colors"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold text-white shrink-0"
                            style={{
                              background:
                                "linear-gradient(135deg, #5B3FA8, #0099CC)",
                            }}
                          >
                            {c.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-[#1A1A2E]">
                              {c.name}
                            </p>
                            <p className="text-xs text-[#9B9BB5]">
                              {new Date(c.created_at).toLocaleString("sv-SE", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-xs font-mono bg-[#F8F6FF] text-[#5B3FA8] px-2.5 py-1 rounded-lg border border-[#E8E0FF] font-bold">
                          {c.reference_code}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-sm font-bold text-[#1A1A2E]">
                          {c.amount
                            ? `${Number(c.amount).toLocaleString("sv-SE")} kr`
                            : "–"}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${c.status === "verified" ? "bg-green-50 text-green-700 border border-green-100" : "bg-amber-50 text-amber-700 border border-amber-100"}`}
                        >
                          <div
                            className={`w-1.5 h-1.5 rounded-full ${c.status === "verified" ? "bg-green-500" : "bg-amber-400"}`}
                          />
                          {c.status === "verified"
                            ? "Verifierad"
                            : "Overifierad"}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 justify-end">
                          {c.status === "unverified" ? (
                            <button
                              onClick={() =>
                                updateContribution.mutate({
                                  contributionId: c.id,
                                  status: "verified",
                                })
                              }
                              className="text-xs font-bold text-[#5B3FA8] hover:bg-[#F0EBFF] px-3 py-1.5 rounded-lg border border-[#E8E0FF] transition-colors flex items-center gap-1"
                            >
                              <CheckCircle2 size={12} /> Verifiera
                            </button>
                          ) : (
                            <button
                              onClick={() =>
                                updateContribution.mutate({
                                  contributionId: c.id,
                                  status: "unverified",
                                })
                              }
                              className="text-xs font-bold text-[#9B9BB5] hover:bg-gray-50 px-3 py-1.5 rounded-lg border border-[#E8E0FF] transition-colors flex items-center gap-1"
                            >
                              <RotateCcw size={12} /> Ångra
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteConfirm(c)}
                            className="text-xs font-bold text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-100 transition-colors flex items-center gap-1"
                          >
                            <Trash2 size={12} /> Ta bort
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Activity log */}
        {collection.audit && collection.audit.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#E8E0FF] shadow-sm overflow-hidden">
            <button
              onClick={() => setShowAudit(!showAudit)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#F8F6FF] transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-bold text-[#1A1A2E]">
                <History size={15} className="text-[#5B3FA8]" /> Aktivitetslogg
              </span>
              <span className="text-xs text-[#9B9BB5]">
                {collection.audit.length} händelser {showAudit ? "▲" : "▼"}
              </span>
            </button>
            {showAudit && (
              <ul className="divide-y divide-[#F0EBFF] border-t border-[#E8E0FF]">
                {collection.audit.map((e, i) => {
                  const { label, extra } = describeAudit(e);
                  return (
                    <li
                      key={i}
                      className="px-5 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1A1A2E]">
                          {label}
                        </p>
                        {extra && (
                          <p className="text-xs text-[#9B9BB5] truncate">{extra}</p>
                        )}
                      </div>
                      <span className="text-xs text-[#C4C4D4] shrink-0">
                        {new Date(e.created_at).toLocaleString("sv-SE", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Footer share */}
        <div className="bg-white rounded-2xl border border-[#E8E0FF] p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
          <div>
            <p className="text-sm font-bold text-[#1A1A2E]">
              Dela insamlingen med fler
            </p>
            <p className="text-xs text-[#9B9BB5] mt-0.5">
              Skicka den offentliga länken till bidragsgivare.
            </p>
          </div>
          <button
            onClick={handleShare}
            className="flex items-center gap-2 font-bold text-sm text-white px-5 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-sm shrink-0"
            style={{
              background:
                "linear-gradient(135deg, #5B3FA8 0%, #0099CC 50%, #FF8C3B 100%)",
            }}
          >
            <Share2 size={15} />{" "}
            {shareSuccess ? "Delat! ✓" : "Dela insamlingen"}
          </button>
        </div>
      </main>

      {/* Mobile floating share */}
      <div className="fixed bottom-6 right-4 z-30 sm:hidden">
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
