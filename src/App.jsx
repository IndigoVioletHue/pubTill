import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Pub Till Prototype (offline-friendly)
 * - Price Bands (with units like Single/Double)
 * - Products referencing bands
 * - Overrides for individually-priced items
 * - Basket, Total, Change calculator
 * - Persists to localStorage
 *
 * Money is stored as integer pence to avoid float issues.
 */

// ---------- Helpers ----------
const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
const formatPence = (p) => GBP.format((p || 0) / 100);
function bestLineTotalWithDeals({ unitPricePence, qty, deals }) {
  // If no deals, simple total
  if (!deals || deals.length === 0 || qty <= 0) {
    return { totalPence: unitPricePence * qty, dealNote: null };
  }

  // Only supporting "bundle" deals right now (e.g. 3 for 700)
  const bundleDeals = deals.filter((d) => d && d.type === "bundle" && d.qty > 0 && d.pricePence >= 0);

  if (bundleDeals.length === 0) {
    return { totalPence: unitPricePence * qty, dealNote: null };
  }

  // Choose the cheapest outcome among all bundle options (single-type bundles)
  // (If you ever add multiple different deals, this picks the best single deal schema.)
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

const clampInt = (n, min, max) => Math.max(min, Math.min(max, n));

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ---------- Default Data Model ----------
const DEFAULT_STATE = {
  "pinEnabled": false,
  "pin": "1234",
  "bands": [
    {
      "id": "band-premium-spirits",
      "name": "Premium Spirits",
      "units": ["Single", "Double"],
      "pricesPence": { "Single": 290, "Double": 490 }
    },
    {
      "id": "band-top-shelf-spirits",
      "name": "Top Shelf Spirits",
      "units": ["Single", "Double"],
      "pricesPence": { "Single": 310, "Double": 510 }
    },
    {
      "id": "band-top-top-shelf-spirits",
      "name": "Top Top Shelf Spirits",
      "units": ["Single", "Double"],
      "pricesPence": { "Single": 380, "Double": 670 }
    },
    {
      "id": "band-low-abv",
      "name": "Low ABV",
      "units": ["Single", "Double"],
      "pricesPence": { "Single": 260, "Double": 420 }
    }
  ],
  "products": [
    { "id": "p-premium-spirit", "name": "Premium Spirit", "category": "Spirits", "bandId": "band-premium-spirits" },
    { "id": "p-top-shelf-spirit", "name": "Top Shelf Spirit", "category": "Spirits", "bandId": "band-top-shelf-spirits" },
    { "id": "p-top-top-shelf-spirit", "name": "Top Top Shelf Spirit", "category": "Spirits", "bandId": "band-top-top-shelf-spirits" },
    { "id": "p-low-abv", "name": "Low ABV Drink", "category": "Spirits", "bandId": "band-low-abv" },

    { "id": "p-staropramen", "name": "Staropramen", "category": "Draft", "units": ["Half", "Pint"], "pricesPence": { "Half": 220, "Pint": 440 } },
    { "id": "p-cold-river-cider", "name": "Cold River Cider", "category": "Draft", "units": ["Half", "Pint"], "pricesPence": { "Half": 190, "Pint": 380 } },

    { "id": "p-atlantic-pale-ale", "name": "Atlantic Pale Ale", "category": "Draft", "units": ["Half", "Pint"], "pricesPence": { "Half": 190, "Pint": 380 }, "notes": "Priced same as Cold River Cider" },
    { "id": "p-carling", "name": "Carling", "category": "Draft", "units": ["Half", "Pint"], "pricesPence": { "Half": 190, "Pint": 380 }, "notes": "Priced same as Cold River Cider" },
    { "id": "p-doom-bar", "name": "Doom Bar", "category": "Draft", "units": ["Half", "Pint"], "pricesPence": { "Half": 190, "Pint": 380 }, "notes": "Priced same as Cold River Cider" },

    { "id": "p-carling-dark-fruits", "name": "Carling Dark Fruits (Dark Fruits)", "category": "Draft", "units": ["Half", "Pint"], "pricesPence": { "Half": 195, "Pint": 390 } },
    { "id": "p-guinness", "name": "Guinness", "category": "Draft", "units": ["Half", "Pint"], "pricesPence": { "Half": 225, "Pint": 450 } },

    { "id": "p-shots", "name": "Shots", "category": "Shots", "units": ["One"], "pricesPence": { "One": 290 } },

    {
      "id": "p-bombs",
      "name": "Bombs",
      "category": "Shots",
      "units": ["One"],
      "pricesPence": { "One": 290 },
      "deals": [{ "type": "bundle", "qty": 3, "pricePence": 700 }]
    },

    { "id": "p-soft-drinks", "name": "Soft Drinks", "category": "Softs", "units": ["Half", "Pint"], "pricesPence": { "Half": 150, "Pint": 300 } },

    { "id": "p-j20", "name": "J20", "category": "Softs", "units": ["One", "Mixer"], "pricesPence": { "One": 250, "Mixer": 200 } },

    { "id": "p-mixer-charge", "name": "Mixer Charge", "category": "Add-ons", "units": ["One"], "pricesPence": { "One": 70 } },

    { "id": "p-vape", "name": "Vape", "category": "Other", "units": ["One"], "pricesPence": { "One": 600 } },

    {
      "id": "p-cocktail",
      "name": "Cocktail",
      "category": "Cocktails",
      "units": ["One"],
      "pricesPence": { "One": 700 },
      "deals": [{ "type": "bundle", "qty": 2, "pricePence": 1200 }]
    },

    { "id": "p-small-bottles", "name": "Small Bottles", "category": "Bottles", "units": ["One"], "pricesPence": { "One": 330 } },
    { "id": "p-big-bottles", "name": "Big Bottles", "category": "Bottles", "units": ["One"], "pricesPence": { "One": 420 } },
    { "id": "p-butty-back", "name": "Butty Back", "category": "Bottles", "units": ["One"], "pricesPence": { "One": 360 } },
    { "id": "p-newcastle-brown-ale", "name": "Newcastle Brown Ale", "category": "Bottles", "units": ["One"], "pricesPence": { "One": 360 } },

    { "id": "p-wine", "name": "Wine", "category": "Wine", "units": ["One"], "pricesPence": { "One": 350 } },
    { "id": "p-hooch", "name": "Hooch", "category": "Bottles", "units": ["One"], "pricesPence": { "One": 400 } }
  ]
};

const LS_KEY = "pub-till-prototype-v1";

// ---------- App ----------
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

  // Admin/edit mode
  const [adminOpen, setAdminOpen] = useState(false);
  const [pinEntry, setPinEntry] = useState("");
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }, [state]);

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

  const pinnedOnSpirits = useMemo(() => {
  // Add-ons you want to show inside Spirits for speed
  const ids = ["p-mixer-charge"];
  return ids.map((id) => productById.get(id)).filter(Boolean);
  }, [productById]);

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


  const categories = useMemo(() => {
    const set = new Set(state.products.map((p) => p.category));
    return Array.from(set);
  }, [state.products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.products
      .filter((p) => p.category === activeCategory)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [state.products, activeCategory, search]);

  const totalPence = useMemo(() => {
    return basket.reduce((sum, line) => sum + lineTotal(line).totalPence, 0);
  }, [basket, productById]);


  const changePence = useMemo(() => cashPence - totalPence, [cashPence, totalPence]);

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

  function addToBasket(product, unit) {
    const { pricesPence } = resolveUnitsAndPrices(product);
    const pricePence = pricesPence[unit] ?? 0;

    const label =
      unit === "One" ? product.name : `${product.name} (${unit})`;

    // Group lines by (productId + unit + price)
    const existingIndex = basket.findIndex(
      (l) => l.productId === product.id && l.unit === unit && l.pricePence === pricePence
    );

    if (existingIndex >= 0) {
      const next = basket.map((l, i) =>
        i === existingIndex ? { ...l, qty: l.qty + 1 } : l
      );
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
  }

  function setCashFromPounds(input) {
    // accept "12.34" or "12"
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
    setAuthed(!state.pinEnabled); // if pin not enabled, auto-auth
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

  // ---------- UI ----------
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.title}>Pub Till (Prototype)</div>
          <div style={styles.subtitle}>Offline-friendly • Bands + overrides • Totals + change</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.btn} onClick={openAdmin}>Edit Prices</button>
          <button style={styles.btnDanger} onClick={clearSale}>Clear Sale</button>
        </div>
      </header>

      <main style={styles.main}>
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
            <button style={styles.btn} onClick={() => setSearch("")}>Clear</button>
          </div>

         <div style={styles.grid}>
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
                <div style={{ fontWeight: 700 }}>{u}</div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  {formatPence(pricesPence[u] || 0)}
                </div>
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
            <div style={{ fontWeight: 800, fontSize: 18 }}>Basket</div>
            <button style={styles.btn} onClick={undoLastAdd} disabled={!basket.length}>
              Undo
            </button>
          </div>

          <div style={styles.basket}>
            {basket.length === 0 ? (
              <div style={{ opacity: 0.7 }}>Add items to start a sale.</div>
            ) : (
              basket.map((l) => (
                <div key={l.key} style={styles.line}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{l.label}</div>
                    <div style={{ opacity: 0.8 }}>{formatPence(l.pricePence)} each</div>
                  </div>

                  <div style={styles.qtyBox}>
                    <button style={styles.qtyBtn} onClick={() => decQty(l.key)}>-</button>
                    <div style={{ width: 24, textAlign: "center", fontWeight: 800 }}>{l.qty}</div>
                    <button style={styles.qtyBtn} onClick={() => incQty(l.key)}>+</button>
                  </div>

                  {(() => {
                    const { totalPence: lineTotalPence, dealNote } = lineTotal(l);
                    return (
                      <div style={{ width: 120, textAlign: "right" }}>
                        <div style={{ fontWeight: 800 }}>{formatPence(lineTotalPence)}</div>
                        {dealNote && (
                          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
                            Deal: {dealNote}
                          </div>
                        )}
                      </div>
                    );
                  })()}


                  <button style={styles.trashBtn} onClick={() => removeLine(l.key)} title="Remove">
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          <div style={styles.totalBox}>
            <div style={styles.totalRow}>
              <div>Total</div>
              <div style={{ fontWeight: 900, fontSize: 22 }}>{formatPence(totalPence)}</div>
            </div>

            <div style={styles.cashRow}>
              <div style={{ fontWeight: 700 }}>Cash received</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  ref={cashInputRef}
                  style={styles.input}
                  placeholder="e.g. 20"
                  onChange={(e) => setCashFromPounds(e.target.value)}
                />
                <button style={styles.btn} onClick={() => { setCashPence(totalPence); if (cashInputRef.current) cashInputRef.current.value = (totalPence/100).toFixed(2); }}>
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
              <div style={{ fontWeight: 900, fontSize: 22 }}>
                {formatPence(Math.abs(changePence))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Admin modal */}
      {adminOpen && (
        <div style={styles.modalOverlay} onClick={closeAdmin}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Edit Prices</div>
              <button style={styles.trashBtn} onClick={closeAdmin} title="Close">×</button>
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
                  <button style={styles.btn} onClick={tryPin}>Unlock</button>
                  <button style={styles.btn} onClick={closeAdmin}>Cancel</button>
                </div>
              </div>
            )}

            {authed && (
              <div style={{ display: "grid", gap: 16 }}>
                <section>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Bands</div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {state.bands.map((b) => (
                      <div key={b.id} style={styles.editCard}>
                        <div style={{ fontWeight: 800 }}>{b.name}</div>
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
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Overrides (individually priced)</div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {state.products
                      .filter((p) => p.pricesPence && p.units)
                      .map((p) => (
                        <div key={p.id} style={styles.editCard}>
                          <div style={{ fontWeight: 800 }}>{p.name}</div>
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
                  <button style={styles.btn} onClick={exportJson}>Export JSON</button>
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
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>PIN</div>
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
                    <button style={styles.btn} onClick={() => alert("PIN saved on blur (click away).")}>
                      Help
                    </button>
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      <footer style={styles.footer}>
        Tip: keep everything as categories + bands; only override draft/softs that need special prices.
      </footer>
    </div>
  );
}

// ---------- Styles (no CSS file needed) ----------
const styles = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(1200px 800px at 20% 0%, rgba(255,255,255,0.08), transparent), #0b0f16",
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
  },
  title: { fontSize: 18, fontWeight: 900 },
  subtitle: { fontSize: 12, opacity: 0.75, marginTop: 2 },

  main: {
    display: "grid",
    gridTemplateColumns: "1.2fr 0.8fr",
    gap: 14,
    padding: 14,
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
    fontWeight: 700,
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
    fontWeight: 800,
  },
  btnDanger: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,120,120,0.35)",
    background: "rgba(255,80,80,0.18)",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
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
  },
  cardMulti: {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
    padding: 12,
  },
  cardName: { fontWeight: 900, marginBottom: 6 },
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
  line: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: 10,
    borderRadius: 14,
    background: "rgba(0,0,0,0.20)",
    border: "1px solid rgba(255,255,255,0.10)",
    marginBottom: 8,
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
    fontWeight: 900,
  },
  trashBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
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
    fontWeight: 900,
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
