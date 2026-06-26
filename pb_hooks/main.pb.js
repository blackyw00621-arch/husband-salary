/// <reference path="../pb_data/types.d.ts" />

// 登入碼是這個 app 唯一的祕密，沒有額外密碼欄位，
// 所以對 /auth-with-password 做節流，降低暴力猜測登入碼的可行性。
// 節流邏輯直接寫在 callback 裡面（不拆成獨立的 top-level function），
// 因為 PocketBase 的 JS hook 在不同 callback 之間共用 top-level function 會出現
// "ReferenceError: xxx is not defined"（已實測確認）。
onRecordAuthWithPasswordRequest((e) => {
  const store = $app.store();
  const now = Math.floor(Date.now() / 1000);
  const key = "loginAttempts:" + e.identity;
  const windowSeconds = 300;
  const maxAttempts = 10;

  const entry = store.get(key);
  if (entry && now - entry.windowStart < windowSeconds && entry.count >= maxAttempts) {
    throw new TooManyRequestsError("嘗試次數過多，請稍後再試。");
  }

  store.setFunc(key, (old) => {
    if (!old || now - old.windowStart >= windowSeconds) {
      return { windowStart: now, count: 1 };
    }
    return { windowStart: old.windowStart, count: old.count + 1 };
  });

  e.next();
}, "users");

// 取代直接開放 users 的 listRule：前端要「用登入碼找到對方帳號 id」
// （切換帳本／新增分享對象）時，改走這個端點，一次只能查一筆、
// 不會洩漏完整使用者清單，且需要先登入才能呼叫。
routerAdd("POST", "/api/resolve-username", (e) => {
  const store = $app.store();
  const now = Math.floor(Date.now() / 1000);
  const key = "resolveAttempts:" + e.auth.id;
  const windowSeconds = 60;
  const maxAttempts = 20;

  const entry = store.get(key);
  if (entry && now - entry.windowStart < windowSeconds && entry.count >= maxAttempts) {
    throw new TooManyRequestsError("嘗試次數過多，請稍後再試。");
  }

  store.setFunc(key, (old) => {
    if (!old || now - old.windowStart >= windowSeconds) {
      return { windowStart: now, count: 1 };
    }
    return { windowStart: old.windowStart, count: old.count + 1 };
  });

  const data = new DynamicModel({ username: "" });
  e.bindBody(data);

  const username = (data.username || "").trim().toLowerCase();
  if (!username) {
    throw new BadRequestError("username 為必填");
  }

  try {
    const record = $app.findFirstRecordByFilter("users", "username = {:username}", { username: username });
    return e.json(200, { exists: true, id: record.id });
  } catch (err) {
    return e.json(200, { exists: false });
  }
}, $apis.requireAuth("users"));
