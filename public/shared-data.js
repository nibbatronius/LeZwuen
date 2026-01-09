(() => {
  const STORAGE_KEY = "lezwuenSharedData";
  const DEFAULT_DATA = { version: 1 };

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function mergeDeep(target, source) {
    const output = { ...target };
    if (!isPlainObject(source)) {
      return output;
    }

    Object.keys(source).forEach((key) => {
      const sourceValue = source[key];
      const targetValue = output[key];
      if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
        output[key] = mergeDeep(targetValue, sourceValue);
      } else {
        output[key] = sourceValue;
      }
    });

    return output;
  }

  function read() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_DATA };
    }

    try {
      const parsed = JSON.parse(raw);
      return isPlainObject(parsed) ? parsed : { ...DEFAULT_DATA };
    } catch (error) {
      return { ...DEFAULT_DATA };
    }
  }

  function write(data) {
    if (!isPlainObject(data)) {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function merge(partial) {
    const base = read();
    const next = mergeDeep(base, partial);
    next.updated_at = new Date().toISOString();
    write(next);
    return next;
  }

  function setCurrency(code) {
    if (!code) {
      return;
    }
    merge({ currency: code });
  }

  window.LeZwuenSharedData = {
    read,
    write,
    merge,
    setCurrency,
    storageKey: STORAGE_KEY
  };
})();
