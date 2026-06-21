import { useState, useEffect } from "react";
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
  ImagePlus,
  Search,
  ArrowDownWideNarrow,
  Megaphone,
} from "lucide-react";
import SwishLogo from "../components/SwishLogo";
import { shareCollection } from "../lib/share";

const AUDIT_LABELS = {
  "contribution.create_manual": "Manuell betalning tillagd",
  "contribution.update": "Bidrag uppdaterat",
  "contribution.bulk_update": "Flera bidrag uppdaterade",
  "contribution.delete": "Bidrag borttaget",
  "collection.extend": "Insamling förlängd",
  "collection.close": "Insamling stängd",
  "collection.reopen": "Insamling återöppnad",
  "collection.cover_update": "Omslagsbild uppdaterad",
  "collection.cover_remove": "Omslagsbild borttagen",
  "update.create": "Uppdatering publicerad",
  "update.delete": "Uppdatering borttagen",
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
  const [search, setSearch] = useState("");
  const [sortByAmount, setSortByAmount] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [updateForm, setUpdateForm] = useState({ title: "", body: "" });
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

  const bulkUpdate = useMutation({
    mutationFn: async ({ ids, status }) => {
      if (!ids.length) return { updated: 0 };
      const res = await api("/api/contributions/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection_id: id, ids, status }),
      });
      if (!res.ok) throw new Error("Misslyckades");
      return res.json();
    },
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries(["collection-admin", id, token]);
    },
  });

  const verifyAll = useMutation({
    mutationFn: async () => {
      const ids = (collection?.contributions || [])
        .filter((c) => c.status === "unverified")
        .map((c) => c.id);
      if (!ids.length) return;
      const res = await api("/api/contributions/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection_id: id, ids, status: "verified" }),
      });
      if (!res.ok) throw new Error("Misslyckades");
    },
    onSuccess: () =>
      queryClient.invalidateQueries(["collection-admin", id, token]),
  });

  const uploadCover = useMutation({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append("image", file);
      const res = await api(`/api/collections/${id}/cover`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Uppladdning misslyckades");
      }
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries(["collection-admin", id, token]),
  });

  const removeCover = useMutation({
    mutationFn: async () => {
      const res = await api(`/api/collections/${id}/cover`, { method: "DELETE" });
      if (!res.ok) throw new Error("Misslyckades");
      return res.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries(["collection-admin", id, token]),
  });

  const postUpdate = useMutation({
    mutationFn: async ({ title, body }) => {
      const res = await api(`/api/collections/${id}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || undefined, body }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Kunde inte publicera");
      }
      return res.json();
    },
    onSuccess: () => {
      setUpdateForm({ title: "", body: "" });
      queryClient.invalidateQueries(["collection-admin", id, token]);
    },
  });

  const deleteUpdate = useMutation({
    mutationFn: async (updateId) => {
      const res = await api(`/api/collections/${id}/updates/${updateId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Misslyckades");
      return res.json();
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
    const ok = await shareCollection({
      url: `${window.location.origin}/c/${id}`,
      title: collection?.title || "Insamling",
      targetAmount: collection?.target_amount,
      suggestedAmount: collection?.suggested_amount,
    });
    if (ok) {
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 3000);
    }
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

  const q = search.trim().toLowerCase();
  let filtered = (collection.contributions || []).filter(
    (c) => activeTab === "all" || c.status === activeTab,
  );
  if (q)
    filtered = filtered.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.reference_code || "").toLowerCase().includes(q) ||
        String(c.amount ?? "").includes(q),
    );
  if (sortByAmount)
    filtered = [...filtered].sort(
      (a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0),
    );

  const unverifiedCount = (collection.contributions || []).filter(
    (c) => c.status === "unverified",
  ).length;
  const verifiedCount = (collection.contributions || []).filter(
    (c) => c.status === "verified",
  ).length;

  const filteredIds = filtered.map((c) => c.id);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((cid) => selected.has(cid));
  const toggleOne = (cid) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(cid) ? next.delete(cid) : next.add(cid);
      return next;
    });
  const toggleAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredIds.forEach((cid) => next.delete(cid));
      else filteredIds.forEach((cid) => next.add(cid));
      return next;
    });
  const selectedIds = [...selected];

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

        {/* Cover image */}
        <div className="bg-white rounded-2xl border border-[#E8E0FF] shadow-sm p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-bold text-[#1A1A2E] flex items-center gap-2">
              <ImagePlus size={15} className="text-[#5B3FA8]" /> Omslagsbild
            </h3>
            {collection.cover_image && (
              <button
                onClick={() => removeCover.mutate()}
                disabled={removeCover.isPending}
                className="text-xs font-bold text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-100 transition-colors disabled:opacity-50"
              >
                Ta bort
              </button>
            )}
          </div>
          {collection.cover_image && (
            <img
              src={collection.cover_image}
              alt="Omslag"
              className="w-full h-40 object-cover rounded-xl border border-[#E8E0FF] mb-3"
            />
          )}
          <label className="inline-flex items-center gap-2 text-sm font-bold text-[#5B3FA8] px-4 py-2.5 rounded-xl border border-[#E8E0FF] bg-white hover:bg-[#F8F6FF] transition-colors cursor-pointer w-fit">
            <ImagePlus size={15} />
            {uploadCover.isPending
              ? "Laddar upp…"
              : collection.cover_image
                ? "Byt bild"
                : "Ladda upp bild"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadCover.mutate(f);
                e.target.value = "";
              }}
            />
          </label>
          <p className="text-xs text-[#9B9BB5] mt-2">
            JPG, PNG eller WEBP, max 3 MB. Visas på sidan och när länken delas.
          </p>
          {uploadCover.isError && (
            <p className="text-sm text-red-500 mt-2">
              {uploadCover.error?.message}
            </p>
          )}
        </div>

        {/* Updates */}
        <div className="bg-white rounded-2xl border border-[#E8E0FF] shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-bold text-[#1A1A2E] flex items-center gap-2">
            <Megaphone size={15} className="text-[#5B3FA8]" /> Uppdateringar
          </h3>
          <div className="space-y-2.5">
            <input
              type="text"
              placeholder="Rubrik (valfritt)"
              className="swish-input"
              value={updateForm.title}
              onChange={(e) =>
                setUpdateForm({ ...updateForm, title: e.target.value })
              }
            />
            <textarea
              rows={3}
              placeholder="Skriv en uppdatering till bidragsgivarna…"
              className="swish-input resize-none"
              value={updateForm.body}
              onChange={(e) =>
                setUpdateForm({ ...updateForm, body: e.target.value })
              }
            />
            {postUpdate.isError && (
              <p className="text-sm text-red-500">{postUpdate.error?.message}</p>
            )}
            <button
              onClick={() => {
                if (updateForm.body.trim()) postUpdate.mutate(updateForm);
              }}
              disabled={postUpdate.isPending || !updateForm.body.trim()}
              className="px-5 py-2.5 rounded-xl font-bold text-white text-sm hover:opacity-90 transition-all disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #5B3FA8, #0099CC)" }}
            >
              {postUpdate.isPending ? "Publicerar…" : "Publicera uppdatering"}
            </button>
          </div>
          {collection.updates?.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-[#F0EBFF]">
              {collection.updates.map((u) => (
                <div key={u.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-[#9B9BB5]">
                      {new Date(u.created_at).toLocaleDateString("sv-SE", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                    {u.title && (
                      <p className="text-sm font-bold text-[#1A1A2E]">
                        {u.title}
                      </p>
                    )}
                    <p className="text-sm text-[#6B6B8D] whitespace-pre-wrap break-words">
                      {u.body}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteUpdate.mutate(u.id)}
                    disabled={deleteUpdate.isPending}
                    className="text-[#9B9BB5] hover:text-red-500 shrink-0 p-1 disabled:opacity-50"
                    aria-label="Ta bort uppdatering"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
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

          {/* Search + sort (assisted matching against your Swish history) */}
          <div className="border-b border-[#E8E0FF] px-5 py-2.5 flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#C4C4D4]"
              />
              <input
                type="text"
                placeholder="Sök namn, referenskod eller belopp…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E8E0FF] bg-white outline-none focus:border-[#5B3FA8] transition-colors"
              />
            </div>
            <button
              onClick={() => setSortByAmount((v) => !v)}
              className={`text-xs font-bold px-3 py-2 rounded-lg border transition-colors flex items-center gap-1.5 ${sortByAmount ? "bg-[#F0EBFF] text-[#5B3FA8] border-[#D9CCFF]" : "text-[#9B9BB5] border-[#E8E0FF] hover:bg-[#F8F6FF]"}`}
            >
              <ArrowDownWideNarrow size={13} /> Belopp
            </button>
          </div>

          {/* Bulk action bar */}
          {selectedIds.length > 0 && (
            <div className="bg-[#F8F6FF] border-b border-[#E8E0FF] px-5 py-2.5 flex items-center justify-between flex-wrap gap-2">
              <span className="text-sm font-bold text-[#5B3FA8]">
                {selectedIds.length} markerade
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    bulkUpdate.mutate({ ids: selectedIds, status: "verified" })
                  }
                  disabled={bulkUpdate.isPending}
                  className="text-xs font-bold text-white px-3 py-1.5 rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                  style={{ background: "linear-gradient(135deg, #5B3FA8, #0099CC)" }}
                >
                  <CheckCircle2 size={13} /> Verifiera markerade
                </button>
                <button
                  onClick={() =>
                    bulkUpdate.mutate({ ids: selectedIds, status: "unverified" })
                  }
                  disabled={bulkUpdate.isPending}
                  className="text-xs font-bold text-[#9B9BB5] px-3 py-1.5 rounded-lg border border-[#E8E0FF] hover:bg-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <RotateCcw size={13} /> Ångra
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-xs font-bold text-[#9B9BB5] px-3 py-1.5 rounded-lg hover:bg-white transition-colors"
                >
                  Avmarkera
                </button>
              </div>
            </div>
          )}

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
                  <th className="pl-5 pr-2 py-3 w-8">
                    <input
                      type="checkbox"
                      className="accent-[#5B3FA8] cursor-pointer"
                      checked={allFilteredSelected}
                      onChange={toggleAllFiltered}
                      aria-label="Markera alla"
                    />
                  </th>
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
                      colSpan={6}
                      className="px-5 py-12 text-center text-sm text-[#9B9BB5]"
                    >
                      Inga bidragsgivare i denna kategori.
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr
                      key={c.id}
                      className={`hover:bg-[#FDFCFF] transition-colors ${selected.has(c.id) ? "bg-[#F8F6FF]" : ""}`}
                    >
                      <td className="pl-5 pr-2 py-4">
                        <input
                          type="checkbox"
                          className="accent-[#5B3FA8] cursor-pointer"
                          checked={selected.has(c.id)}
                          onChange={() => toggleOne(c.id)}
                          aria-label={`Markera ${c.name}`}
                        />
                      </td>
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
