const WORKER_URL = "https://loreal-routine-builder.agusionucherish.workers.dev";
const PRODUCTS_STORAGE_KEY = "lorealRoutineSelectedProducts";
const PREFERENCES_STORAGE_KEY = "lorealRoutinePreferences";
const DIRECTION_STORAGE_KEY = "lorealRoutineDirection";
const MAX_HISTORY_FOR_REQUEST = 12;

let allProducts = [];
let selectedProducts = [];
let conversationHistory = [];
let routineReady = false;
let isRequestPending = false;
let lastDialogTrigger = null;

const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const clearFiltersButton = document.getElementById("clearFiltersButton");
const productsContainer = document.getElementById("productsContainer");
const productsStatus = document.getElementById("productsStatus");
const pageStatus = document.getElementById("pageStatus");
const resultsSummary = document.getElementById("resultsSummary");
const selectedProductsList = document.getElementById("selectedProductsList");
const selectedCount = document.getElementById("selectedCount");
const selectionStatus = document.getElementById("selectionStatus");
const generateRoutineButton = document.getElementById("generateRoutine");
const clearAllButton = document.getElementById("clearAllButton");
const chatWindow = document.getElementById("chatWindow");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("userInput");
const sendButton = document.getElementById("sendBtn");
const chatStatus = document.getElementById("chatStatus");
const preferencesForm = document.getElementById("preferencesForm");
const routineTypeField = document.getElementById("routineType");
const skinTypeField = document.getElementById("skinType");
const hairTypeField = document.getElementById("hairType");
const primaryConcernField = document.getElementById("primaryConcern");
const routineTimeField = document.getElementById("routineTime");
const experienceLevelField = document.getElementById("experienceLevel");
const fragranceSensitivityField = document.getElementById(
  "fragranceSensitivity",
);
const skinPreferenceGroup = document.querySelector("[data-pref-skin]");
const hairPreferenceGroup = document.querySelector("[data-pref-hair]");
const directionToggle = document.getElementById("directionToggle");
const productDialog = document.getElementById("productDialog");
const productDialogBody = document.getElementById("productDialogBody");

const fallbackProductImageLabel = "Product image unavailable";

let productsPromise = null;

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getProductId(product) {
  return product.id ?? `${slugify(product.brand)}-${slugify(product.name)}`;
}

function normalizeProduct(product) {
  return {
    ...product,
    stableId: String(getProductId(product)),
  };
}

function escapeText(value) {
  return String(value ?? "");
}

function formatCategoryLabel(category) {
  return category
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function readJsonStorage(key, fallback) {
  try {
    const rawValue = localStorage.getItem(key);
    if (!rawValue) {
      return fallback;
    }

    const parsedValue = JSON.parse(rawValue);
    return parsedValue;
  } catch (error) {
    console.warn(`Could not read stored data for ${key}.`, error);
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Could not save stored data for ${key}.`, error);
  }
}

function setLiveMessage(target, message, tone = "") {
  const text = message ? String(message) : "";
  if (target) {
    target.textContent = text;
    target.dataset.tone = tone;
  }
  if (pageStatus && target !== pageStatus) {
    pageStatus.textContent = text;
    pageStatus.dataset.tone = tone;
  }
}

function setProductsLoading(isLoading, message = "Loading products…") {
  productsContainer.setAttribute("aria-busy", String(isLoading));
  if (isLoading) {
    productsContainer.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">Loading products</p>
        <p>${message}</p>
      </div>
    `;
    resultsSummary.textContent = message;
    setLiveMessage(productsStatus, message);
  }
}

function getStoredDirection() {
  const savedDirection = localStorage.getItem(DIRECTION_STORAGE_KEY);
  return savedDirection === "rtl" ? "rtl" : "ltr";
}

function applyDirection(direction) {
  document.documentElement.dir = direction;
  localStorage.setItem(DIRECTION_STORAGE_KEY, direction);
  directionToggle.setAttribute("aria-pressed", String(direction === "rtl"));
  directionToggle.setAttribute(
    "aria-label",
    direction === "rtl"
      ? "Switch page direction to left to right"
      : "Switch page direction to right to left",
  );
}

function getSavedPreferences() {
  const fallback = {
    routineType: "mixed",
    skinType: "",
    hairType: "",
    primaryConcern: "",
    routineTime: "both",
    experienceLevel: "beginner",
    fragranceSensitivity: "not sure",
  };

  const storedPreferences = readJsonStorage(PREFERENCES_STORAGE_KEY, fallback);
  return {
    ...fallback,
    ...(storedPreferences && typeof storedPreferences === "object"
      ? storedPreferences
      : {}),
  };
}

function savePreferences() {
  writeJsonStorage(PREFERENCES_STORAGE_KEY, getRoutinePreferences());
}

function loadPreferencesIntoForm() {
  const preferences = getSavedPreferences();
  routineTypeField.value = preferences.routineType;
  skinTypeField.value = preferences.skinType;
  hairTypeField.value = preferences.hairType;
  primaryConcernField.value = preferences.primaryConcern;
  routineTimeField.value = preferences.routineTime;
  experienceLevelField.value = preferences.experienceLevel;
  fragranceSensitivityField.value = preferences.fragranceSensitivity;
}

function getRoutinePreferences() {
  return {
    routineType: routineTypeField.value,
    skinType: skinTypeField.value,
    hairType: hairTypeField.value,
    primaryConcern: primaryConcernField.value,
    routineTime: routineTimeField.value,
    experienceLevel: experienceLevelField.value,
    fragranceSensitivity: fragranceSensitivityField.value,
  };
}

function updatePreferenceVisibility() {
  const selectedCategories = new Set(
    selectedProducts.map((product) => product.category),
  );
  const shouldShowSkin = [
    "cleanser",
    "moisturizer",
    "skincare",
    "suncare",
    "men's grooming",
  ].some((category) => selectedCategories.has(category));
  const shouldShowHair = ["haircare", "hair styling", "hair color"].some(
    (category) => selectedCategories.has(category),
  );

  skinPreferenceGroup.classList.toggle("hidden", !shouldShowSkin);
  hairPreferenceGroup.classList.toggle("hidden", !shouldShowHair);
}

function normalizeStoredSelection(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const validIds = new Map(
    allProducts.map((product) => [String(product.stableId), product]),
  );
  const restored = [];

  value.forEach((item) => {
    const id = String(
      item && (item.stableId ?? item.id ?? item.productId ?? ""),
    );
    const product = validIds.get(id);
    if (
      product &&
      !restored.some((entry) => entry.stableId === product.stableId)
    ) {
      restored.push(product);
    }
  });

  return restored;
}

function saveSelectedProducts() {
  writeJsonStorage(
    PRODUCTS_STORAGE_KEY,
    selectedProducts.map((product) => product.stableId),
  );
}

function restoreSelectedProducts() {
  const storedSelection = readJsonStorage(PRODUCTS_STORAGE_KEY, []);
  selectedProducts = normalizeStoredSelection(storedSelection);
  updatePreferenceVisibility();
  renderSelectedProducts();
}

function productMatchesSearch(product, searchValue) {
  if (!searchValue) {
    return true;
  }

  const haystack = [
    product.name,
    product.brand,
    product.category,
    product.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const id = String(
    typeof item === "string"
      ? item
      : item && (item.stableId ?? item.id ?? item.productId ?? ""),
  );
}

function getFilteredProducts() {
  const selectedCategory = categoryFilter.value;
  const searchValue = productSearch.value.trim().toLowerCase();

  return allProducts.filter((product) => {
    const categoryMatches =
      !selectedCategory || product.category === selectedCategory;
    return categoryMatches && productMatchesSearch(product, searchValue);
  });
}

function updateResultsSummary(filteredProducts) {
  const hasFilters = Boolean(
    categoryFilter.value || productSearch.value.trim(),
  );
  const summaryText = hasFilters
    ? `${filteredProducts.length} product${filteredProducts.length === 1 ? "" : "s"} match your filters`
    : `${filteredProducts.length} products available`;

  resultsSummary.textContent = summaryText;
}

function renderEmptyProductState(
  title,
  message,
  actionLabel = "Clear filters",
) {
  productsContainer.innerHTML = `
    <div class="empty-state">
      <p class="empty-state__title">${escapeText(title)}</p>
      <p>${escapeText(message)}</p>
      <div class="empty-state__actions">
        <button id="emptyStateClearButton" class="secondary-button" type="button">${escapeText(actionLabel)}</button>
      </div>
    </div>
  `;

  const emptyStateClearButton = document.getElementById(
    "emptyStateClearButton",
  );
  emptyStateClearButton?.addEventListener("click", clearFilters);
}

function createPlaceholderMarkup(product) {
  const initials = [product.brand, product.name]
    .map((part) => part?.trim()?.charAt(0) || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return `
    <div class="product-card__placeholder" aria-hidden="true">
      <div class="product-card__placeholder-mark">${escapeText(initials || "L")}</div>
      <div>${fallbackProductImageLabel}</div>
    </div>
  `;
}

function isSelectedProduct(product) {
  return selectedProducts.some((entry) => entry.stableId === product.stableId);
}

function createProductCard(product) {
  const card = document.createElement("article");
  card.className = `product-card${isSelectedProduct(product) ? " is-selected" : ""}`;
  card.dataset.productId = product.stableId;

  const selectionLabel = isSelectedProduct(product)
    ? "Selected"
    : "Add to Routine";
  const selectionPressed = isSelectedProduct(product) ? "true" : "false";
  const descriptionPreview =
    product.description.length > 150
      ? `${product.description.slice(0, 147)}…`
      : product.description;

  card.innerHTML = `
    <div class="product-card__media">
      ${product.image ? `<img src="${escapeText(product.image)}" alt="${escapeText(product.brand)} ${escapeText(product.name)}" loading="lazy" />` : createPlaceholderMarkup(product)}
      ${isSelectedProduct(product) ? '<span class="product-card__badge">Selected</span>' : ""}
    </div>
    <div class="product-card__meta">
      <p class="product-card__brand">${escapeText(product.brand)}</p>
      <h3 class="product-card__title">${escapeText(product.name)}</h3>
      <p class="product-card__category">${escapeText(formatCategoryLabel(product.category))}</p>
      <p class="product-card__description">${escapeText(descriptionPreview)}</p>
    </div>
    <div class="product-card__actions">
      <button class="product-card__button secondary-button" type="button" data-action="details" data-product-id="${escapeText(product.stableId)}">View Details</button>
      <button class="product-card__button primary-button" type="button" data-action="toggle" data-product-id="${escapeText(product.stableId)}" aria-pressed="${selectionPressed}">${selectionLabel}</button>
    </div>
  `;

  const image = card.querySelector("img");
  if (image) {
    image.addEventListener("error", () => {
      image.replaceWith(createProductPlaceholderNode(product));
    });
  }

  return card;
}

function createProductPlaceholderNode(product) {
  const template = document.createElement("template");
  template.innerHTML = createPlaceholderMarkup(product).trim();
  return template.content.firstElementChild;
}

function renderProducts() {
  if (!allProducts.length) {
    return;
  }

  const filteredProducts = getFilteredProducts();
  updateResultsSummary(filteredProducts);

  if (!filteredProducts.length) {
    renderEmptyProductState(
      "No products found",
      "Try a different search term or category. You can clear the filters and start again.",
    );
    return;
  }

  productsContainer.replaceChildren(
    ...filteredProducts.map((product) => createProductCard(product)),
  );
  setLiveMessage(productsStatus, `${filteredProducts.length} products shown.`);
}

function renderCategoryOptions(products) {
  const categories = [
    ...new Set(products.map((product) => product.category)),
  ].sort((left, right) => left.localeCompare(right));

  const currentValue = categoryFilter.value;
  categoryFilter.replaceChildren();

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All Categories";
  categoryFilter.appendChild(allOption);

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = formatCategoryLabel(category);
    categoryFilter.appendChild(option);
  });

  if (
    [...categoryFilter.options].some((option) => option.value === currentValue)
  ) {
    categoryFilter.value = currentValue;
  }
}

function renderSelectedProducts() {
  selectedCount.textContent = `${selectedProducts.length} selected`;
  generateRoutineButton.disabled =
    selectedProducts.length === 0 || isRequestPending;

  if (!selectedProducts.length) {
    selectedProductsList.innerHTML = `
      <div class="empty-state">
        <p class="empty-state__title">No products selected yet</p>
        <p>Pick a few products from the catalog and they will appear here. Your choices save automatically in this browser.</p>
      </div>
    `;
    updatePreferenceVisibility();
    setLiveMessage(selectionStatus, "No products selected.");
    return;
  }

  selectedProductsList.innerHTML = "";
  selectedProducts.forEach((product) => {
    const item = document.createElement("article");
    item.className = "selected-item";
    item.innerHTML = `
      <p class="selected-item__title">${escapeText(product.name)}</p>
      <p class="selected-item__meta">${escapeText(product.brand)}${product.category ? ` · ${escapeText(formatCategoryLabel(product.category))}` : ""}</p>
      <button class="selected-item__remove secondary-button" type="button" data-action="remove-selected" data-product-id="${escapeText(product.stableId)}">Remove</button>
    `;
    selectedProductsList.appendChild(item);
  });

  updatePreferenceVisibility();
  setLiveMessage(
    selectionStatus,
    `${selectedProducts.length} products selected.`,
  );
}

function clearFilters() {
  categoryFilter.value = "";
  productSearch.value = "";
  renderProducts();
  setLiveMessage(pageStatus, "Filters cleared.");
}

function clearAllSelections() {
  selectedProducts = [];
  saveSelectedProducts();
  renderProducts();
  renderSelectedProducts();
  setLiveMessage(selectionStatus, "All selected products were cleared.");
}

function toggleProductSelection(productId) {
  const product = allProducts.find((entry) => entry.stableId === productId);
  if (!product) {
    return;
  }

  const existingIndex = selectedProducts.findIndex(
    (entry) => entry.stableId === productId,
  );
  if (existingIndex >= 0) {
    selectedProducts = selectedProducts.filter(
      (entry) => entry.stableId !== productId,
    );
    setLiveMessage(
      selectionStatus,
      `${product.name} removed from your selections.`,
    );
  } else {
    selectedProducts = [...selectedProducts, product];
    setLiveMessage(
      selectionStatus,
      `${product.name} added to your selections.`,
    );
  }

  saveSelectedProducts();
  renderProducts();
  renderSelectedProducts();
}

function openProductDetails(productId, triggerButton) {
  const product = allProducts.find((entry) => entry.stableId === productId);
  if (!product || !productDialogBody || !productDialog) {
    return;
  }

  lastDialogTrigger = triggerButton || document.activeElement;

  productDialogBody.innerHTML = `
    <div class="product-dialog__body">
      <div class="dialog-product-media">
        ${product.image ? `<img src="${escapeText(product.image)}" alt="${escapeText(product.brand)} ${escapeText(product.name)}" />` : createPlaceholderMarkup(product)}
      </div>
      <div class="dialog-product-meta">
        <p class="product-card__brand">${escapeText(product.brand)}</p>
        <h3 id="productDialogTitle" class="dialog-product-title">${escapeText(product.name)}</h3>
        <p class="product-card__category">${escapeText(formatCategoryLabel(product.category))}</p>
      </div>
      <div class="dialog-product-details">${escapeText(product.description)}</div>
    </div>
  `;

  productDialog.showModal();
}

function closeProductDetails() {
  if (productDialog.open) {
    productDialog.close();
  }
}

function renderMarkdownIntoElement(targetElement, markdownText) {
  const safeText = String(markdownText ?? "");

  // If markdown libraries are unavailable, preserve readable plain text output.
  if (!window.marked || !window.DOMPurify) {
    targetElement.textContent = safeText;
    return;
  }

  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  const unsafeHtml = marked.parse(safeText);
  const safeHtml = DOMPurify.sanitize(unsafeHtml);
  targetElement.innerHTML = safeHtml;

  // Open generated links in a new tab with safe rel attributes.
  targetElement.querySelectorAll("a").forEach((link) => {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  });
}

function createMessageElement(role, text) {
  const message = document.createElement("article");
  message.className = `chat-message chat-message--${role}`;
  const label = document.createElement("span");
  label.className = "chat-message__label";
  label.textContent = role === "user" ? "You" : "L'Oréal Advisor";
  const content = document.createElement("div");
  content.className = `chat-message__content chat-message__content--${role}`;

  if (role === "assistant") {
    renderMarkdownIntoElement(content, text);
  } else {
    content.textContent = text;
  }

  message.append(label, content);
  return message;
}

function addChatMessage(role, text) {
  const message = String(text ?? "").trim();
  if (!message) {
    return;
  }

  conversationHistory.push({ role, content: message });
  chatWindow.appendChild(createMessageElement(role, message));
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function getConversationHistoryForRequest() {
  if (conversationHistory.length <= MAX_HISTORY_FOR_REQUEST) {
    return conversationHistory;
  }

  const initialMessages = conversationHistory.slice(0, 2);
  const recentMessages = conversationHistory.slice(
    -Math.max(6, MAX_HISTORY_FOR_REQUEST - 2),
  );

  return [
    ...initialMessages,
    ...recentMessages.filter(
      (message, index, array) => array.indexOf(message) === index,
    ),
  ];
}

function setRequestState(isPending, source = "routine") {
  isRequestPending = isPending;
  generateRoutineButton.disabled = selectedProducts.length === 0 || isPending;
  sendButton.disabled = !routineReady || isPending;
  chatInput.disabled = !routineReady || isPending;

  if (source === "routine") {
    generateRoutineButton.textContent = isPending
      ? "Generating…"
      : "Generate My Routine";
  }

  if (source === "chat") {
    sendButton.textContent = isPending ? "Sending…" : "Send Message";
  }
}

function getWorkerRequestBody(action, extraFields = {}) {
  return {
    action,
    selectedProducts: selectedProducts.map((product) => ({
      id: product.id,
      stableId: product.stableId,
      name: product.name,
      brand: product.brand,
      category: product.category,
      description: product.description,
    })),
    preferences: getRoutinePreferences(),
    conversationHistory: getConversationHistoryForRequest(),
    ...extraFields,
  };
}

function validateWorkerUrl() {
  if (WORKER_URL.includes("PASTE_YOUR_WORKER_URL_HERE")) {
    throw new Error("Worker URL has not been configured yet.");
  }
}

async function callRoutineWorker(body) {
  validateWorkerUrl();

  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("The routine service returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(
      data?.error || "The routine service could not complete the request.",
    );
  }

  if (!data || typeof data.reply !== "string") {
    throw new Error("The routine service returned an unexpected response.");
  }

  return data;
}

async function generateRoutine() {
  if (!selectedProducts.length) {
    setLiveMessage(
      pageStatus,
      "Select at least one product before generating a routine.",
      "error",
    );
    return;
  }

  try {
    setRequestState(true, "routine");
    setLiveMessage(pageStatus, "Generating your routine…");
    addChatMessage(
      "user",
      "Please build a personalized routine using my selected products and preferences.",
    );

    const response = await callRoutineWorker(
      getWorkerRequestBody("generateRoutine"),
    );
    addChatMessage("assistant", response.reply);
    routineReady = true;
    chatInput.disabled = false;
    sendButton.disabled = false;
    setLiveMessage(
      chatStatus,
      "Routine generated. You can now ask follow-up questions.",
    );
  } catch (error) {
    console.error("Routine generation failed:", error);
    setLiveMessage(
      pageStatus,
      error.message || "The routine could not be generated right now.",
      "error",
    );
  } finally {
    setRequestState(false, "routine");
  }
}

async function sendChatMessage(event) {
  event.preventDefault();

  const message = chatInput.value.trim();
  if (!message || !routineReady || isRequestPending) {
    return;
  }

  try {
    setRequestState(true, "chat");
    addChatMessage("user", message);
    chatInput.value = "";
    setLiveMessage(chatStatus, "Sending your follow-up question…");

    const response = await callRoutineWorker(
      getWorkerRequestBody("chat", { message }),
    );
    addChatMessage("assistant", response.reply);
    setLiveMessage(chatStatus, "Reply received.");
  } catch (error) {
    console.error("Chat request failed:", error);
    setLiveMessage(
      chatStatus,
      error.message || "The follow-up question could not be sent.",
      "error",
    );
  } finally {
    setRequestState(false, "chat");
  }
}

async function loadProducts() {
  if (productsPromise) {
    return productsPromise;
  }

  productsPromise = (async () => {
    setProductsLoading(true);

    try {
      const response = await fetch("products.json");
      if (!response.ok) {
        throw new Error(`Failed to load products.json (${response.status})`);
      }

      const data = await response.json();
      if (!data || !Array.isArray(data.products)) {
        throw new Error("products.json does not contain a products array.");
      }

      allProducts.splice(
        0,
        allProducts.length,
        ...data.products.map(normalizeProduct),
      );
      renderCategoryOptions(allProducts);
      restoreSelectedProducts();
      renderProducts();
      savePreferences();
      setLiveMessage(pageStatus, `${allProducts.length} products loaded.`);
      return allProducts;
    } catch (error) {
      console.error("Unable to load products:", error);
      productsContainer.innerHTML = `
        <div class="empty-state">
          <p class="empty-state__title">Products could not be loaded</p>
          <p>There was a problem loading the product catalog. Please refresh the page or try again later.</p>
        </div>
      `;
      resultsSummary.textContent = "Product loading failed";
      setLiveMessage(productsStatus, "Product loading failed.", "error");
      productsPromise = null;
      throw error;
    } finally {
      productsContainer.setAttribute("aria-busy", "false");
    }
  })();

  return productsPromise;
}

function wireEvents() {
  categoryFilter.addEventListener("change", renderProducts);
  productSearch.addEventListener("input", renderProducts);
  clearFiltersButton.addEventListener("click", clearFilters);
  clearAllButton.addEventListener("click", clearAllSelections);
  generateRoutineButton.addEventListener("click", generateRoutine);
  chatForm.addEventListener("submit", sendChatMessage);
  preferencesForm.addEventListener("change", savePreferences);

  directionToggle.addEventListener("click", () => {
    applyDirection(document.documentElement.dir === "rtl" ? "ltr" : "rtl");
  });

  productsContainer.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const productId = button.dataset.productId;
    const action = button.dataset.action;

    if (action === "toggle") {
      toggleProductSelection(productId);
    }

    if (action === "details") {
      openProductDetails(productId, button);
    }
  });

  selectedProductsList.addEventListener("click", (event) => {
    const button = event.target.closest(
      "button[data-action='remove-selected']",
    );
    if (!button) {
      return;
    }

    toggleProductSelection(button.dataset.productId);
  });

  productDialog.addEventListener("close", () => {
    lastDialogTrigger?.focus?.();
    lastDialogTrigger = null;
  });

  productDialog.addEventListener("click", (event) => {
    const dialogRect = productDialog.getBoundingClientRect();
    const clickedOutside =
      event.clientX < dialogRect.left ||
      event.clientX > dialogRect.right ||
      event.clientY < dialogRect.top ||
      event.clientY > dialogRect.bottom;

    if (clickedOutside) {
      closeProductDetails();
    }
  });

  productDialogBody.addEventListener("click", (event) => {
    if (event.target.closest(".dialog-close")) {
      closeProductDetails();
    }
  });

  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });
}

function seedChatWindow() {
  if (chatWindow.childElementCount) {
    return;
  }

  chatWindow.appendChild(
    createMessageElement(
      "assistant",
      "Select products, build a routine, and then ask me follow-up questions about the steps, product order, or how to use them safely.",
    ),
  );
}

async function initializeApp() {
  wireEvents();
  applyDirection(getStoredDirection());
  loadPreferencesIntoForm();
  seedChatWindow();
  setRequestState(false);
  setLiveMessage(pageStatus, "Loading products and restoring your selections…");

  try {
    await loadProducts();
  } catch (error) {
    console.error(
      "Initialization continued after a product loading error.",
      error,
    );
  }
}

initializeApp();
