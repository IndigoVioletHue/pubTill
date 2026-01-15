import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Pub Till Prototype (offline-friendly)
 * - Price Bands (with units like Single/Double)
 * - Products referencing bands
 * - Overrides for individually-priced items
 * - Basket, Total, Change calculator
 * - Bundle deals (e.g. 3 for £7, 2 for £12) auto-applied
 * - Mixer button pinned on Spirits tab
 * - Mobile-friendly layout + reduced layout shift in basket
 * - Persists config to localStorage
 *
 * Money is stored as integer pence to avoid float issues.
 */

// ---------- Helpers ----------
const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const formatPence = (p) => GBP.format((p || 0) / 100);

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Calculates best line total given bundle deals.
 * Supports deals shaped like: { type:"bundle", qty:3, pricePence:700 }
 */
function bestLineTotalWithDeals({ unitPricePence, qty, deals }) {
  if (!deals || deals.length === 0 || qty <= 0) {
    return { totalPence: unitPricePence * qty, dealNote: null };
  }

  const bundleDeals = deals.filter(
    (d) => d && d.type === "bundle" && Number.isFinite(d.qty) && d.qty > 0 && Number.isFinite(d.pricePence) && d.pricePence >= 0
  );

  if (bundleDeals.length === 0) {
    return { totalPence: unitPricePence * qty, dealNote: null };
  }

  let best = { totalPence: unitPricePence * qty, dealNote: null };

  for (const d of bundleDeals) {
    const bundles = Math.floor(qty / d.qty);
    const remainder = qty % d.qty;
    const total = bundles * d.pricePence + remainder * unitPricePence;

    if (total < best.totalPence) {
      best = {
        totalPence: total,
        dealNote: bundles > 0 ? `${d.qty} for ${formatPence(d.pricePence)} × ${bundles}` : null,
      };
    }
  }

  return best;
}

// ---------- Default Data Model ----------
// You can replace this with your imported JSON config if you want.
const DEFAULT_STATE = {
  bands: [
    { id: "band-premium", name: "Premium Spirits", units: ["Single", "Double"], pricesPence: { Single: 450, Double: 850 } },
    { id: "band-topshelf", name: "Top Shelf Spirits", units: ["Single", "Double"], pricesPence: { Single: 550, Double: 1050 } },
    { id: "band-toptop", name: "Top Top Shelf", units: ["Single", "Double"], pricesPence: { Single: 700, Double: 1350 } },
    { id: "band-lowabv", name: "Low ABV", units: ["Half", "Pint"], pricesPence: { Half: 320, Pint: 620 } }
  ],

  products: [
    { id: "p-gin1", name: "Tanqueray", category: "Spirits", bandId: "band-premium" },
    { id: "p-vod1", name: "Smirnoff", category: "Spirits", bandId: "band-premium" },
    { id: "p-vod2", name: "Grey Goose", category: "Spirits", bandId: "band-topshelf" },
    { id: "p-teq1", name: "Don Julio 1942", category: "Spirits", bandId: "band-toptop" },

    { id: "p-guin", name: "Guinness", category: "Draft", units: ["Half", "Pint"], pricesPence: { Half: 340, Pint: 660 } },
    { id: "p-lager", name: "House Lager", category: "Draft", units: ["Half", "Pint"], pricesPence: { Half: 310, Pint: 610 } },

    { id: "p-coke", name: "Coke", category: "Softs", units: ["Half", "Pint"], pricesPence: { Half: 160, Pint: 300 } },

    // Mixer charge exists in data but will be pinned on Spirits tab
    { id: "p-mixer-charge", name: "Mixer Charge", category: "Add-ons", units: ["One"], pricesPence: { One: 70 } },

    // Deals example
    { id: "p-bombs", name: "Bombs", category: "Shots", units: ["One"], pricesPence: { One: 290 }, deals: [{ type: "bundle", qty: 3, pricePence: 700 }] },
    { id: "p-cocktail", name: "Cocktail", category: "Cocktails", units: ["One"], pricesPence: { One: 700 }, deals: [{ type: "bundle", qty: 2, pricePence: 1200 }] }
  ],

  pinEnabled: false,
  pin: "1234",
};

const LS_KEY = "pub-till-prototype-v1";

export default function App() {
  const [state, setState] = useState(() => {
    const saved = localStorage.getItem(LS_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_STATE;
  });

  const [activeCategory, setActiveCategory] = useState("Spirits");
  const [search, setSearch] = useState("");
  const [basket, setBasket] = useState([]); // [{ key, productId, label, unit, pricePence, qty }]
  const [lastAddKey, setLastAddKey] = useState(null);

  const [cashPence, setCashPence] = useState(0);
  const cashInputRef = useRef(null);

  // Responsive layout
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 900px)").matches);

  // Admin/edit mode
  const [adminOpen, setAdminOpen] = useState(false);
  const [pinEntry, setPinEntry] = useState("");
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  // Derived lookups
  const bandById = useMemo(() => {
    const map = new Map();
    state.bands.forEach((b) => map.set(b.id, b));
    return map;
  }, [state.bands]);

  const productById = useMemo(() => {
    const map = new Map();
    state.products.forEach((p) => map.set(p.id, p));
    return map;
  }, [state.products]);

  // Hide Add-ons tab (mixer is pinned on Spirits)
  const categories = useMemo(() => {
    const set = new Set(state.products.map((p) => p.category));
    return Array.from(set).filter((c) => c !== "Add-ons");
  }, [state.products]);

  const pinnedOnSpirits = useMemo(() => {
    const ids = ["p-mixer-charge"];
    return ids.map((id) => productById.get(id)).filter(Boolean);
  }, [productById]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.products
      .filter((p) => p.category === activeCategory)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state.products, activeCategory, search]);

  function resolveUnitsAndPrices(product) {
    // Override-priced product
    if (product.pricesPence && product.units) {
      return { units: product.units, pricesPence: product.pricesPence };
    }

    // Band-priced product
    const band = bandById.get(product.bandId);
    if (!band) return { units: ["One"], pricesPence: { One: 0 } };
    return { units: band.units, pricesPence: band.pricesPence };
  }

  function lineTotal(line) {
    const product = productById.get(line.productId);
    const deals = product?.deals;

    const { totalPence, dealNote } = bestLineTotalWithDeals({
      unitPricePence: line.pricePence,
      qty: line.qty,
      deals,
    });

    return { totalPence, dealNote };
  }

  const totalPence = useMemo(() => {
    return basket.reduce((sum, line) => sum + lineTotal(line).totalPence, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basket, productById]);

  const changePence = useMemo(() => cashPence - totalPence, [cashPence, totalPence]);

  function addToBasket(product, unit) {
    const { pricesPence } = resolveUnitsAndPrices(product);
    const pricePence = pricesPence[unit] ?? 0;

    const label = unit === "One" ? product.name : `${product.name} (${unit})`;

    // Group lines by (productId + unit + price)
    const existingIndex = basket.findIndex(
      (l) => l.productId === product.id && l.unit === unit && l.pricePence === pricePence
    );

    if (existingIndex >= 0) {
      const next = basket.map((l, i) => (i === existingIndex ? { ...l, qty: l.qty + 1 } : l));
      setBasket(next);
      setLastAddKey(next[existingIndex].key);
      return;
    }

    const line = {
      key: uid(),
      productId: product.id,
      label,
      unit,
      pricePence,
      qty: 1,
    };
    setBasket((b) => [...b, line]);
    setLastAddKey(line.key);
  }

  function incQty(key) {
    setBasket((b) => b.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)));
  }

  function decQty(key) {
    setBasket((b) =>
      b
        .map((l) => (l.key === key ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0)
    );
  }

  function removeLine(key) {
    setBasket((b) => b.filter((l) => l.key !== key));
  }

  function undoLastAdd() {
    if (!lastAddKey) return;
    decQty(lastAddKey);
  }

  function clearSale() {
    if (!confirm("Clear the current sale?")) return;
    setBasket([]);
    setCashPence(0);
    setLastAddKey(null);
    if (cashInputRef.current) cashInputRef.current.value = "";
  }

  function setCashFromPounds(input) {
    const cleaned = (input || "").replace(/[^\d.]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) {
      setCashPence(0);
      return;
    }
    setCashPence(Math.round(n * 100));
  }

  // ---------- Admin / pricing edits ----------
  function openAdmin() {
    setAdminOpen(true);
    setPinEntry("");
    setAuthed(!state.pinEnabled);
  }

  function closeAdmin() {
    setAdminOpen(false);
    setPinEntry("");
    setAuthed(false);
  }

  function tryPin() {
    if (pinEntry === state.pin) setAuthed(true);
    else alert("Wrong PIN");
  }

  function updateBandPrice(bandId, unit, newPence) {
    setState((s) => ({
      ...s,
      bands: s.bands.map((b) =>
        b.id === bandId ? { ...b, pricesPence: { ...b.pricesPence, [unit]: newPence } } : b
      ),
    }));
  }

  function updateOverridePrice(productId, unit, newPence) {
    setState((s) => ({
      ...s,
      products: s.products.map((p) => {
        if (p.id !== productId) return p;
        return { ...p, pricesPence: { ...(p.pricesPence || {}), [unit]: newPence } };
      }),
    }));
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pub-till-config.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = JSON.parse(reader.result);
        setState(next);
        alert("Imported config.");
      } catch {
        alert("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.title}>Pub Till</div>
          <div style={styles.subtitle}>Offline-friendly • Deals + mixer pin • Total + change</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.btn} onClick={openAdmin}>
            Edit Prices
          </button>
          <button style={styles.btnDanger} onClick={clearSale}>
            Clear Sale
          </button>
        </div>
      </header>

      <main
        style={{
          ...styles.main,
          gridTemplateColumns: isMobile ? "1fr" : "1.2fr 0.8fr",
        }}
      >
        {/* Left: product picker */}
        <section style={styles.panel}>
          <div style={styles.tabs}>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCategory(c)}
                style={{
                  ...styles.tab,
                  ...(activeCategory === c ? styles.tabActive : {}),
                }}
              >
                {c}
              </button>
            ))}
          </div>

          <div style={styles.searchRow}>
            <input
              style={styles.input}
              placeholder="Search (e.g. guin, goose)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button style={styles.btn} onClick={() => setSearch("")}>
              Clear
            </button>
          </div>

          <div
            style={{
              ...styles.grid,
              gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : styles.grid.gridTemplateColumns,
              maxHeight: isMobile ? "none" : styles.grid.maxHeight,
            }}
          >
            {/* Pinned items on Spirits */}
            {activeCategory === "Spirits" &&
              pinnedOnSpirits.map((p) => {
                const { units } = resolveUnitsAndPrices(p);
                const unit = units?.[0] ?? "One";
                const { pricesPence } = resolveUnitsAndPrices(p);

                return (
                  <button
                    key={p.id}
                    style={{
                      ...styles.card,
                      border: "1px solid rgba(255,255,255,0.22)",
                      background: "rgba(255,255,255,0.10)",
                    }}
                    onClick={() => addToBasket(p, unit)}
                    title={`${p.name} • ${formatPence(pricesPence[unit] || 0)}`}
                  >
                    <div style={styles.cardName}>{p.name}</div>
                    <div style={styles.cardMeta}>{formatPence(pricesPence[unit] || 0)}</div>
                  </button>
                );
              })}

            {filteredProducts.map((p) => {
              const { units } = resolveUnitsAndPrices(p);

              // If it's just one unit ("One"), make it single-tap
              if (units.length === 1) {
                const unit = units[0];
                const { pricesPence } = resolveUnitsAndPrices(p);
                return (
                  <button
                    key={p.id}
                    style={styles.card}
                    onClick={() => addToBasket(p, unit)}
                    title={`${p.name} • ${formatPence(pricesPence[unit] || 0)}`}
                  >
                    <div style={styles.cardName}>{p.name}</div>
                    <div style={styles.cardMeta}>{formatPence(pricesPence[unit] || 0)}</div>
                  </button>
                );
              }

              // Multi-unit: show product with unit buttons
              return (
                <div key={p.id} style={styles.cardMulti}>
                  <div style={styles.cardName}>{p.name}</div>
                  <div style={styles.unitRow}>
                    {units.map((u) => {
                      const { pricesPence } = resolveUnitsAndPrices(p);
                      return (
                        <button
                          key={u}
                          style={styles.unitBtn}
                          onClick={() => addToBasket(p, u)}
                          title={`${u} • ${formatPence(pricesPence[u] || 0)}`}
                        >
                          <div style={{ fontWeight: 800 }}>{u}</div>
                          <div style={{ fontSize: 12, opacity: 0.85 }}>{formatPence(pricesPence[u] || 0)}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right: basket + totals */}
        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Basket</div>
            <button style={styles.btn} onClick={undoLastAdd} disabled={!basket.length}>
              Undo
            </button>
          </div>

          <div style={styles.basket}>
            {basket.length === 0 ? (
              <div style={{ opacity: 0.7 }}>Add items to start a sale.</div>
            ) : (
              basket.map((l) => {
                const { totalPence: lineTotalPence, dealNote } = lineTotal(l);

                return (
                  <div key={l.key} style={styles.line}>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 800,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={l.label}
                      >
                        {l.label}
                      </div>
                      <div
                        style={{
                          opacity: 0.8,
                          fontSize: 12,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {formatPence(l.pricePence)} each
                        {dealNote ? ` • Deal active` : ""}
                      </div>
                    </div>

                    <div style={styles.qtyBox}>
                      <button style={styles.qtyBtn} onClick={() => decQty(l.key)}>
                        -
                      </button>
                      <div style={{ width: 24, textAlign: "center", fontWeight: 900 }}>{l.qty}</div>
                      <button style={styles.qtyBtn} onClick={() => incQty(l.key)}>
                        +
                      </button>
                    </div>

                    <div style={{ width: 92, textAlign: "right" }}>
                      <div style={{ fontWeight: 900 }}>{formatPence(lineTotalPence)}</div>
                      {dealNote && (
                        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                          Deal: {dealNote}
                        </div>
                      )}
                    </div>

                    <button style={styles.trashBtn} onClick={() => removeLine(l.key)} title="Remove">
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div
            style={{
              ...styles.totalBox,
              position: isMobile ? "sticky" : "static",
              bottom: isMobile ? 0 : "auto",
              background: isMobile ? "rgba(11,15,22,0.92)" : "transparent",
              backdropFilter: isMobile ? "blur(10px)" : "none",
              padding: isMobile ? 10 : 0,
              borderRadius: isMobile ? 14 : 0,
            }}
          >
            <div style={styles.totalRow}>
              <div>Total</div>
              <div style={{ fontWeight: 1000, fontSize: 22 }}>{formatPence(totalPence)}</div>
            </div>

            <div style={styles.cashRow}>
              <div style={{ fontWeight: 800 }}>Cash received</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  ref={cashInputRef}
                  style={styles.input}
                  placeholder="e.g. 20"
                  onChange={(e) => setCashFromPounds(e.target.value)}
                />
                <button
                  style={styles.btn}
                  onClick={() => {
                    setCashPence(totalPence);
                    if (cashInputRef.current) cashInputRef.current.value = (totalPence / 100).toFixed(2);
                  }}
                >
                  Exact
                </button>
              </div>
            </div>

            <div style={styles.quickCash}>
              {[500, 1000, 2000, 5000].map((v) => (
                <button
                  key={v}
                  style={styles.quickBtn}
                  onClick={() => {
                    setCashPence(v);
                    if (cashInputRef.current) cashInputRef.current.value = (v / 100).toFixed(2);
                  }}
                >
                  {formatPence(v)}
                </button>
              ))}
            </div>

            <div style={styles.totalRow}>
              <div>{changePence >= 0 ? "Change" : "Still owed"}</div>
              <div style={{ fontWeight: 1000, fontSize: 22 }}>{formatPence(Math.abs(changePence))}</div>
            </div>
          </div>
        </section>
      </main>

      {/* Admin modal */}
      {adminOpen && (
        <div style={styles.modalOverlay} onClick={closeAdmin}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={{ fontWeight: 1000, fontSize: 18 }}>Edit Prices</div>
              <button style={styles.trashBtn} onClick={closeAdmin} title="Close">
                ×
              </button>
            </div>

            {!authed && (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ opacity: 0.85 }}>Enter PIN to edit prices.</div>
                <input
                  style={styles.input}
                  value={pinEntry}
                  onChange={(e) => setPinEntry(e.target.value)}
                  placeholder="PIN"
                  type="password"
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button style={styles.btn} onClick={tryPin}>
                    Unlock
                  </button>
                  <button style={styles.btn} onClick={closeAdmin}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {authed && (
              <div style={{ display: "grid", gap: 16 }}>
                <section>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>Bands</div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {state.bands.map((b) => (
                      <div key={b.id} style={styles.editCard}>
                        <div style={{ fontWeight: 900 }}>{b.name}</div>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {b.units.map((u) => (
                            <label key={u} style={styles.editField}>
                              <div style={{ fontSize: 12, opacity: 0.8 }}>{u}</div>
                              <input
                                style={styles.input}
                                defaultValue={((b.pricesPence[u] || 0) / 100).toFixed(2)}
                                onBlur={(e) => {
                                  const n = Number(e.target.value);
                                  if (!Number.isFinite(n)) return;
                                  updateBandPrice(b.id, u, Math.round(n * 100));
                                }}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>Overrides (individually priced)</div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {state.products
                      .filter((p) => p.pricesPence && p.units)
                      .map((p) => (
                        <div key={p.id} style={styles.editCard}>
                          <div style={{ fontWeight: 900 }}>{p.name}</div>
                          <div style={{ opacity: 0.8, fontSize: 12 }}>{p.category}</div>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                            {p.units.map((u) => (
                              <label key={u} style={styles.editField}>
                                <div style={{ fontSize: 12, opacity: 0.8 }}>{u}</div>
                                <input
                                  style={styles.input}
                                  defaultValue={(((p.pricesPence?.[u] || 0) / 100).toFixed(2))}
                                  onBlur={(e) => {
                                    const n = Number(e.target.value);
                                    if (!Number.isFinite(n)) return;
                                    updateOverridePrice(p.id, u, Math.round(n * 100));
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </section>

                <section style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button style={styles.btn} onClick={exportJson}>
                    Export JSON
                  </button>
                  <label style={styles.btn} title="Import JSON">
                    Import JSON
                    <input
                      type="file"
                      accept="application/json"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) importJson(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    style={styles.btnDanger}
                    onClick={() => {
                      if (!confirm("Reset everything to defaults?")) return;
                      setState(DEFAULT_STATE);
                      alert("Reset.");
                    }}
                  >
                    Reset Defaults
                  </button>
                </section>

                <section style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>PIN</div>
                  <label style={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={state.pinEnabled}
                      onChange={(e) => setState((s) => ({ ...s, pinEnabled: e.target.checked }))}
                    />
                    Require PIN to edit prices
                  </label>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input
                      style={styles.input}
                      defaultValue={state.pin}
                      onBlur={(e) => setState((s) => ({ ...s, pin: e.target.value || "1234" }))}
                      placeholder="New PIN"
                    />
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      <footer style={styles.footer}>Tip: Mixer Charge is pinned on Spirits. Deals auto-apply for Bombs/Cocktails.</footer>
    </div>
  );
}

// ---------- Styles ----------
const styles = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(1200px 800px at 20% 0%, rgba(255,255,255,0.08), transparent), #0b0f16",
    color: "white",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  },
  header: {
    padding: 16,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid rgba(255,255,255,0.12)",
    position: "sticky",
    top: 0,
    background: "rgba(11,15,22,0.8)",
    backdropFilter: "blur(10px)",
    zIndex: 5,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: 1000 },
  subtitle: { fontSize: 12, opacity: 0.75, marginTop: 2 },

  main: {
    display: "grid",
    gridTemplateColumns: "1.2fr 0.8fr",
    gap: 14,
    padding: 14,
    alignItems: "start",
  },

  panel: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 16,
    padding: 12,
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
    minHeight: 0,
  },

  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
  },

  tabs: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 10,
  },
  tab: {
    padding: "8px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "white",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 13,
  },
  tabActive: {
    background: "rgba(255,255,255,0.16)",
    borderColor: "rgba(255,255,255,0.25)",
  },

  searchRow: { display: "flex", gap: 8, marginBottom: 10 },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "white",
    outline: "none",
    fontSize: 14,
  },

  btn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.10)",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  btnDanger: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,120,120,0.35)",
    background: "rgba(255,80,80,0.18)",
    color: "white",
    cursor: "pointer",
    fontWeight: 1000,
    whiteSpace: "nowrap",
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
    gap: 10,
    maxHeight: "calc(100vh - 190px)",
    overflow: "auto",
    paddingRight: 4,
  },

  card: {
    textAlign: "left",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
    padding: 12,
    cursor: "pointer",
    minHeight: 74,
  },
  cardMulti: {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
    padding: 12,
    minHeight: 74,
  },
  cardName: { fontWeight: 1000, marginBottom: 6 },
  cardMeta: { opacity: 0.8, fontSize: 13 },
  unitRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  unitBtn: {
    flex: 1,
    minWidth: 84,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    padding: "8px 10px",
    cursor: "pointer",
    textAlign: "left",
  },

  basket: {
    maxHeight: "calc(100vh - 380px)",
    overflow: "auto",
    paddingRight: 4,
  },

  // grid basket row to prevent layout shift
  line: {
    display: "grid",
    gridTemplateColumns: "1fr auto 92px 34px",
    gap: 10,
    alignItems: "center",
    padding: 10,
    borderRadius: 14,
    background: "rgba(0,0,0,0.20)",
    border: "1px solid rgba(255,255,255,0.10)",
    marginBottom: 8,
    minWidth: 0,
  },

  qtyBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 6,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
  },
  qtyBtn: {
    width: 30,
    height: 30,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.10)",
    color: "white",
    cursor: "pointer",
    fontWeight: 1000,
  },
  trashBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    cursor: "pointer",
    fontWeight: 1000,
    lineHeight: "30px",
  },

  totalBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid rgba(255,255,255,0.12)",
    display: "grid",
    gap: 10,
  },

  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 10,
  },
  cashRow: { display: "grid", gap: 8 },
  quickCash: { display: "flex", gap: 8, flexWrap: "wrap" },
  quickBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.10)",
    color: "white",
    cursor: "pointer",
    fontWeight: 1000,
    whiteSpace: "nowrap",
  },

  footer: {
    padding: 14,
    opacity: 0.7,
    fontSize: 12,
    textAlign: "center",
  },

  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.65)",
    display: "grid",
    placeItems: "center",
    zIndex: 50,
    padding: 14,
  },
  modal: {
    width: "min(900px, 100%)",
    maxHeight: "min(85vh, 900px)",
    overflow: "auto",
    background: "#0b0f16",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 16,
    padding: 12,
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    gap: 10,
  },
  editCard: {
    padding: 10,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
  },
  editField: { display: "grid", gap: 6, minWidth: 140 },
  checkboxRow: { display: "flex", alignItems: "center", gap: 10 },
};
