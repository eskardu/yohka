import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, LocateFixed, Minus, Pencil, Plus, Settings, ShoppingCart, Trash2 } from "lucide-react";
import { formatMoney } from "@yohkar/shared";
import { getCartTotals } from "./cart.js";
import { createProduct, deactivateProduct, getCategories, getProducts, getSettings, postOrder, updateProduct, updateSettings, uploadImage, weekdayOptions, type Settings as AppSettings } from "./api.js";
import type { CartLine, Category, Product } from "./types.js";

type View = "catalog" | "cart" | "success" | "admin" | "admin-login";

const adminTelegramIds = (import.meta.env.VITE_ADMIN_TELEGRAM_IDS ?? "")
  .split(",")
  .map((id: string) => id.trim())
  .filter(Boolean);
const adminPin = import.meta.env.VITE_ADMIN_PIN ?? "1234";
const apiAssetBase = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const unitOptions = [
  { value: "kg", label: "кг" },
  { value: "piece", label: "штук" },
  { value: "pack", label: "упаковка" },
  { value: "liter", label: "литр" }
] as const;

const badgeOptions = [
  { value: "", label: "Без стикера" },
  { value: "NEW", label: "Новинка" },
  { value: "HIT", label: "Хит" },
  { value: "DISCOUNT", label: "Скидка" },
  { value: "2+1", label: "2+1" },
  { value: "3+1", label: "3+1" }
] as const;

export function App() {
  const [view, setView] = useState<View>("catalog");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof getSettings>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successNumber, setSuccessNumber] = useState<number | null>(null);
  const [adminUnlocked, setAdminUnlocked] = useState(() => localStorage.getItem("yohkar-admin-unlocked") === "true");
  const telegramUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  const isTelegramAdmin = telegramUserId ? adminTelegramIds.includes(String(telegramUserId)) : false;
  const canShowAdminButton = !telegramUserId || isTelegramAdmin || adminUnlocked;

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    window.Telegram?.WebApp?.requestFullscreen?.();
  }, []);

  useEffect(() => {
    Promise.all([getSettings(), getCategories(), getProducts()])
      .then(([settingsData, categoryData, productData]) => {
        setSettings(settingsData);
        setCategories(categoryData);
        setProducts(productData);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const shownProducts = useMemo(() => products, [products]);
  const totals = getCartTotals(cart, products);
  const deliveryFee =
    settings && (totals.subtotal >= settings.freeDeliveryFromAmount || totals.kg >= settings.freeDeliveryFromKg)
      ? 0
      : settings?.deliveryFee ?? 0;
  const finalTotal = totals.subtotal + deliveryFee;

  function changeQuantity(productId: string, delta: number) {
    setCart((current) => {
      const product = products.find((item) => item.id === productId);
      const stock = product ? Number(product.stockQuantity) : 0;
      const existing = current.find((line) => line.productId === productId);
      const currentQuantity = existing?.quantity ?? 0;
      if (delta > 0 && (!product || stock <= 0 || currentQuantity >= stock)) return current;
      if (!existing && delta > 0) return [...current, { productId, quantity: delta }];
      return current
        .map((line) =>
          line.productId === productId
            ? { ...line, quantity: Math.max(0, line.quantity + delta) }
            : line
        )
        .filter((line) => line.quantity > 0);
    });
  }

  if (loading) return <Shell><div className="state">Загружаем магазин...</div></Shell>;
  if (error) return <Shell><div className="state error">{error}</div></Shell>;

  return (
    <Shell>
      {view === "catalog" && (
        <>
          <header className="topbar">
            <div className="store-header-media">
              {settings?.headerImageUrl ? <img src={imageSrc(settings.headerImageUrl)} alt="" /> : <div className="store-header-empty" />}
            </div>
            {canShowAdminButton && (
              <button
                className="round-tool"
                onClick={() => (isTelegramAdmin || adminUnlocked ? setView("admin") : setView("admin-login"))}
                aria-label="Управление товарами"
              >
                <Settings size={20} />
              </button>
            )}
          </header>

          <section className="delivery-note">
            <strong>{settings?.deliveryTitle ?? "Ближайшие дни доставки"}:</strong> {settings?.deliveryDays.join(", ")}
          </section>

          <main className="product-grid">
            {shownProducts.map((product) => {
              const quantity = cart.find((line) => line.productId === product.id)?.quantity ?? 0;
              const price = product.discountPrice ?? product.salePrice;
              const stock = Number(product.stockQuantity);
              const canAdd = stock > 0 && quantity < stock;
              return (
                <article className={`product-card${stock <= 0 ? " out-of-stock" : ""}`} key={product.id}>
                  <img src={imageSrc(product.imageUrl) ?? fallbackImage(product.name)} alt="" />
                  {product.badge && <span className="product-badge">{formatBadge(product.badge)}</span>}
                  <div className="product-info">
                    <h2>{product.name}</h2>
                    <div className="product-meta">
                      <strong>{formatMoney(price)}</strong>
                      <span>/{formatUnit(product.unit)}</span>
                    </div>
                  </div>
                  {quantity > 0 && <span className="product-count">{quantity}</span>}
                  <div className="product-actions" aria-label={`Количество ${product.name}`}>
                    <button className="add-button" onClick={() => changeQuantity(product.id, 1)} disabled={!canAdd}>
                      <Plus size={16} />
                      <span>Добавить</span>
                    </button>
                    <button className="minus-button" onClick={() => changeQuantity(product.id, -1)} aria-label="Уменьшить">
                      <Minus size={16} />
                    </button>
                  </div>
                </article>
              );
            })}
          </main>

          {totals.itemCount > 0 && (
            <button className="sticky-cart" onClick={() => setView("cart")}>
              <ShoppingCart size={18} />
              <span>{totals.itemCount} товаров</span>
              <strong>{formatMoney(finalTotal)}</strong>
            </button>
          )}
        </>
      )}

      {view === "cart" && (
        <CartView
          cart={cart}
          products={products}
          subtotal={totals.subtotal}
          deliveryFee={deliveryFee}
          finalTotal={finalTotal}
          deliveryDays={settings?.deliveryDays ?? []}
          onBack={() => setView("catalog")}
          onChange={changeQuantity}
          onClear={() => setCart([])}
          onSuccess={(orderNumber) => {
            setSuccessNumber(orderNumber);
            setCart([]);
            setView("success");
          }}
        />
      )}

      {view === "success" && (
        <section className="success">
          <Check size={42} />
          <h1>Заказ #{successNumber} отправлен</h1>
          <p>Админ получил уведомление. Мы свяжемся с вами перед доставкой.</p>
          <button onClick={() => setView("catalog")}>Вернуться в магазин</button>
        </section>
      )}

      {view === "admin" && (
        <AdminProductsView
          categories={categories}
          products={products}
          settings={settings}
          onBack={() => setView("catalog")}
          onProductsChange={setProducts}
          onSettingsChange={setSettings}
        />
      )}

      {view === "admin-login" && (
        <AdminLoginView
          onBack={() => setView("catalog")}
          onSuccess={() => {
            localStorage.setItem("yohkar-admin-unlocked", "true");
            setAdminUnlocked(true);
            setView("admin");
          }}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="app-shell">{children}</div>;
}

function CartView({
  cart,
  products,
  subtotal,
  deliveryFee,
  finalTotal,
  deliveryDays,
  onBack,
  onChange,
  onClear,
  onSuccess
}: {
  cart: CartLine[];
  products: Product[];
  subtotal: number;
  deliveryFee: number;
  finalTotal: number;
  deliveryDays: string[];
  onBack: () => void;
  onChange: (productId: string, delta: number) => void;
  onClear: () => void;
  onSuccess: (orderNumber: number) => void;
}) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const [contact, setContact] = useState("");
  const [comment, setComment] = useState("");
  const [deliveryDay] = useState(deliveryDays[0] ?? "");
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function requestLocation() {
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      },
      () => setError("Не удалось получить геолокацию. Разрешите доступ к местоположению."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function submitOrder() {
    if (!location) {
      setError("Сначала отправьте местоположение.");
      return;
    }

    const unavailableLine = cart.find((line) => {
      const product = byId.get(line.productId);
      return !product || Number(product.stockQuantity) < line.quantity;
    });
    if (unavailableLine) {
      const productName = byId.get(unavailableLine.productId)?.name ?? "товар";
      setError(`Товар "${productName}" нет в нужном количестве.`);
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const order = await postOrder({
        initData: window.Telegram?.WebApp?.initData,
        telegramUser: tgUser ?? { id: 100000001, first_name: "Dev", username: "dev_user" },
        customerName: tgUser?.first_name ?? "Telegram client",
        customerPhone: contact.trim() || "не указан",
        customerComment: comment,
        addressText: undefined,
        latitude: location.latitude,
        longitude: location.longitude,
        paymentMethod: "CASH",
        deliveryDay: isIsoDate(deliveryDay) ? deliveryDay : undefined,
        items: cart
      });
      onSuccess(order.orderNumber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка отправки заказа");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="panel">
      <button className="icon-row" onClick={onBack}><ChevronLeft size={18} /> Каталог</button>
      <div className="panel-heading">
        <h1>Корзина</h1>
        <button className="ghost" onClick={onClear}><Trash2 size={16} /> Очистить</button>
      </div>
      {cart.map((line) => {
        const product = byId.get(line.productId);
        if (!product) return null;
        const price = Number(product.discountPrice ?? product.salePrice);
        const canAdd = line.quantity < Number(product.stockQuantity);
        return (
          <div className="cart-line" key={line.productId}>
            <div>
              <h2>{product.name}</h2>
              <p>{line.quantity} × {formatMoney(price)} = {formatMoney(price * line.quantity)}</p>
            </div>
            <div className="quantity-control compact">
              <button onClick={() => onChange(product.id, -1)}><Minus size={16} /></button>
              <span>{line.quantity}</span>
              <button onClick={() => onChange(product.id, 1)} disabled={!canAdd}><Plus size={16} /></button>
            </div>
          </div>
        );
      })}
      <Totals subtotal={subtotal} deliveryFee={deliveryFee} finalTotal={finalTotal} />
      <label>Контакт<input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="+966..." /></label>
      <label>Комментарий<textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label>
      <p className="location-hint">Для подтверждения нажмите отправить местоположение</p>
      <button className={`location${location ? " received" : ""}`} onClick={requestLocation}>
        {location ? <Check size={18} /> : <LocateFixed size={18} />}
        {location ? "Местоположение получено" : "Отправить местоположение"}
      </button>
      {error && <p className="form-error">{error}</p>}
      <button className="primary" disabled={!cart.length || submitting || !location} onClick={submitOrder}>
        {submitting ? "Отправляем..." : "Подтвердить заказ"}
      </button>
    </main>
  );
}

type ProductForm = {
  id?: string;
  name: string;
  description: string;
  categoryId: string;
  badge: string;
  purchasePrice: string;
  salePrice: string;
  discountPrice: string;
  unit: string;
  stockQuantity: string;
  imageUrl: string;
};

function emptyForm(categoryId = ""): ProductForm {
  return {
    name: "",
    description: "",
    categoryId,
    badge: "",
    purchasePrice: "",
    salePrice: "",
    discountPrice: "",
    unit: "kg",
    stockQuantity: "",
    imageUrl: ""
  };
}

function AdminProductsView({
  categories,
  products,
  settings,
  onBack,
  onProductsChange,
  onSettingsChange
}: {
  categories: Category[];
  products: Product[];
  settings: AppSettings | null;
  onBack: () => void;
  onProductsChange: (products: Product[]) => void;
  onSettingsChange: (settings: AppSettings) => void;
}) {
  const [form, setForm] = useState<ProductForm>(() => emptyForm(categories[0]?.id));
  const [newDeliveryDay, setNewDeliveryDay] = useState("");
  const [deliveryTitle, setDeliveryTitle] = useState(settings?.deliveryTitle ?? "Ближайшие дни доставки");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [headerUploading, setHeaderUploading] = useState(false);
  const [productUploading, setProductUploading] = useState(false);

  function patchForm(patch: Partial<ProductForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  async function uploadHeaderPhoto(file?: File | null) {
    if (!file || !settings) return;
    setHeaderUploading(true);
    setMessage("");
    setError("");
    try {
      const uploaded = await uploadImage(file, "header");
      const savedSettings = await updateSettings({ headerImageUrl: uploaded.url });
      onSettingsChange(savedSettings);
      setMessage("Шапка сайта обновлена.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить шапку");
    } finally {
      setHeaderUploading(false);
    }
  }

  async function removeHeaderPhoto() {
    if (!settings) return;
    setMessage("");
    setError("");
    try {
      const savedSettings = await updateSettings({ headerImageUrl: null });
      onSettingsChange(savedSettings);
      setMessage("Шапка сайта удалена.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить шапку");
    }
  }

  async function uploadProductPhoto(file?: File | null) {
    if (!file) return;
    setProductUploading(true);
    setMessage("");
    setError("");
    try {
      const uploaded = await uploadImage(file, "product");
      patchForm({ imageUrl: uploaded.url });
      setMessage("Фото товара загружено.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить фото товара");
    } finally {
      setProductUploading(false);
    }
  }

  function editProduct(product: Product) {
    setMessage("");
    setError("");
    setForm({
      id: product.id,
      name: product.name,
      description: product.description ?? "",
      categoryId: product.categoryId,
      badge: product.badge ?? "",
      purchasePrice: String(product.purchasePrice),
      salePrice: String(product.salePrice),
      discountPrice: product.discountPrice ?? "",
      unit: product.unit,
      stockQuantity: String(product.stockQuantity),
      imageUrl: product.imageUrl ?? ""
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveProduct() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        categoryId: form.categoryId || categories[0]?.id,
        badge: form.badge || null,
        purchasePrice: Number(form.purchasePrice || 0),
        salePrice: Number(form.salePrice),
        discountPrice: form.discountPrice ? Number(form.discountPrice) : null,
        unit: form.unit.trim() || "piece",
        stockQuantity: Number(form.stockQuantity),
        imageUrl: form.imageUrl.trim() || null,
        isActive: true
      };

      if (!payload.name || !payload.categoryId || !Number.isFinite(payload.salePrice) || !Number.isFinite(payload.stockQuantity)) {
        throw new Error("Заполните название, категорию, цену и остаток.");
      }

      if (form.id) {
        await updateProduct(form.id, payload);
      } else {
        await createProduct(payload);
      }

      onProductsChange(await getProducts());
      setForm(emptyForm(categories[0]?.id));
      setMessage(form.id ? "Товар обновлен." : "Товар добавлен.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить товар");
    } finally {
      setSaving(false);
    }
  }

  async function hideProduct(productId: string) {
    setMessage("");
    setError("");
    try {
      await deactivateProduct(productId);
      onProductsChange(await getProducts());
      if (form.id === productId) setForm(emptyForm(categories[0]?.id));
      setMessage("Товар скрыт из каталога.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось скрыть товар");
    }
  }

  async function addDeliveryDay() {
    if (!settings || !newDeliveryDay) return;
    setMessage("");
    setError("");
    try {
      const deliveryDays = weekdayOptions.filter((day) => [...settings.deliveryDays, newDeliveryDay].includes(day));
      const savedSettings = await updateSettings({ deliveryDays });
      onSettingsChange(savedSettings);
      setNewDeliveryDay("");
      setMessage("День доставки добавлен.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить день доставки");
    }
  }

  async function removeDeliveryDay(day: string) {
    if (!settings) return;
    setMessage("");
    setError("");
    try {
      const savedSettings = await updateSettings({ deliveryDays: settings.deliveryDays.filter((item) => item !== day) });
      onSettingsChange(savedSettings);
      setMessage("День доставки удален.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить день доставки");
    }
  }

  async function updateDeliveryTitle() {
    if (!settings) return;
    setMessage("");
    setError("");
    try {
      const title = deliveryTitle.trim() || "Ближайшие дни доставки";
      const savedSettings = await updateSettings({ deliveryTitle: title });
      onSettingsChange(savedSettings);
      setDeliveryTitle(savedSettings.deliveryTitle ?? title);
      setMessage("Текст доставки обновлен.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить текст доставки");
    }
  }

  return (
    <main className="panel admin-panel">
      <button className="icon-row" onClick={onBack}><ChevronLeft size={18} /> Магазин</button>
      <div className="panel-heading">
        <h1>Товары</h1>
        {form.id && <button className="ghost" onClick={() => setForm(emptyForm(categories[0]?.id))}>Новый товар</button>}
      </div>

      <section className="admin-form header-editor">
        <h2>Шапка сайта</h2>
        {settings?.headerImageUrl && <img className="header-preview" src={imageSrc(settings.headerImageUrl)} alt="" />}
        <label>Фото или логотип
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={headerUploading}
            onChange={(event) => uploadHeaderPhoto(event.target.files?.[0])}
          />
        </label>
        {settings?.headerImageUrl && (
          <button className="ghost" onClick={removeHeaderPhoto}>Убрать шапку</button>
        )}
      </section>

      <section className="admin-form delivery-editor">
        <h2>Дни доставки</h2>
        <label>Текст строки
          <input value={deliveryTitle} onChange={(event) => setDeliveryTitle(event.target.value)} />
        </label>
        <button className="primary secondary-action" onClick={updateDeliveryTitle}>Сохранить текст</button>
        <div className="delivery-day-list">
          {settings?.deliveryDays.map((day) => (
            <div className="delivery-day-chip" key={day}>
              <span>{day}</span>
              <button onClick={() => removeDeliveryDay(day)} aria-label="Удалить день доставки">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="delivery-day-add">
          <select value={newDeliveryDay} onChange={(event) => setNewDeliveryDay(event.target.value)}>
            <option value="">Выберите день</option>
            {weekdayOptions.map((day) => (
              <option value={day} key={day}>{day}</option>
            ))}
          </select>
          <button className="primary" onClick={addDeliveryDay} disabled={!newDeliveryDay}>Добавить</button>
        </div>
      </section>

      <section className="admin-form">
        <label>Название<input value={form.name} onChange={(event) => patchForm({ name: event.target.value })} /></label>
        <input type="hidden" value={form.categoryId} readOnly />
        <label>Описание<textarea value={form.description} onChange={(event) => patchForm({ description: event.target.value })} /></label>
        <label>Стикер
          <select value={form.badge} onChange={(event) => patchForm({ badge: event.target.value })}>
            {badgeOptions.map((badge) => (
              <option value={badge.value} key={badge.value}>{badge.label}</option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>Закупка<input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(event) => patchForm({ purchasePrice: event.target.value })} /></label>
          <label>Цена<input type="number" min="0" step="0.01" value={form.salePrice} onChange={(event) => patchForm({ salePrice: event.target.value })} /></label>
        </div>
        <div className="form-grid">
          <label>Скидочная цена<input type="number" min="0" step="0.01" value={form.discountPrice} onChange={(event) => patchForm({ discountPrice: event.target.value })} /></label>
          <label>Остаток<input type="number" min="0" step="0.001" value={form.stockQuantity} onChange={(event) => patchForm({ stockQuantity: event.target.value })} /></label>
        </div>
        <div className="form-grid">
          <label>Единица
            <select value={form.unit} onChange={(event) => patchForm({ unit: event.target.value })}>
              {unitOptions.map((unit) => (
                <option value={unit.value} key={unit.value}>{unit.label}</option>
              ))}
            </select>
          </label>
          <label>Фото URL<input value={form.imageUrl} onChange={(event) => patchForm({ imageUrl: event.target.value })} /></label>
        </div>
        <label>Фото с телефона
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={productUploading}
            onChange={(event) => uploadProductPhoto(event.target.files?.[0])}
          />
        </label>
        {form.imageUrl && <img className="product-photo-preview" src={imageSrc(form.imageUrl)} alt="" />}
        {message && <p className="form-success">{message}</p>}
        {error && <p className="form-error">{error}</p>}
        <button className="primary" disabled={saving} onClick={saveProduct}>
          {saving ? "Сохраняем..." : form.id ? "Сохранить изменения" : "Добавить товар"}
        </button>
      </section>

      <section className="admin-list">
        {products.map((product) => (
          <article className="admin-product" key={product.id}>
            <div className="admin-product-image">
              <img src={imageSrc(product.imageUrl) ?? fallbackImage(product.name)} alt="" />
              {product.badge && <span>{formatBadge(product.badge)}</span>}
            </div>
            <div>
              <h2>{product.name}</h2>
              <p>{formatMoney(product.discountPrice ?? product.salePrice)} / {formatUnit(product.unit)}</p>
              <p>Остаток: {Number(product.stockQuantity)}</p>
            </div>
            <div className="admin-actions">
              <button onClick={() => editProduct(product)} aria-label="Редактировать"><Pencil size={16} /></button>
              <button onClick={() => hideProduct(product.id)} aria-label="Скрыть"><Trash2 size={16} /></button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function AdminLoginView({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  function submit() {
    if (pin === adminPin) {
      onSuccess();
      return;
    }
    setError("Неверный PIN.");
  }

  return (
    <main className="panel admin-login">
      <button className="icon-row" onClick={onBack}><ChevronLeft size={18} /> Магазин</button>
      <h1>Вход в админку</h1>
      <label>PIN<input value={pin} onChange={(event) => setPin(event.target.value)} inputMode="numeric" type="password" /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary" onClick={submit}>Войти</button>
    </main>
  );
}

function Totals({ subtotal, deliveryFee, finalTotal }: { subtotal: number; deliveryFee: number; finalTotal: number }) {
  return (
    <div className="totals">
      <div><span>Товары</span><strong>{formatMoney(subtotal)}</strong></div>
      <div><span>Доставка</span><strong>{deliveryFee === 0 ? "бесплатно" : formatMoney(deliveryFee)}</strong></div>
      <div><span>Итого</span><strong>{formatMoney(finalTotal)}</strong></div>
    </div>
  );
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatUnit(unit: string) {
  return unitOptions.find((option) => option.value === unit)?.label ?? unit;
}

function formatBadge(badge: string) {
  return badgeOptions.find((option) => option.value === badge)?.label ?? badge;
}

function fallbackImage(seed: string) {
  return `https://placehold.co/600x400/e7f1e8/1d3324?text=${encodeURIComponent(seed)}`;
}

function imageSrc(src?: string | null) {
  if (!src) return undefined;
  if (src.startsWith("/")) return `${apiAssetBase}${src}`;
  return src;
}
