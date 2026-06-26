/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("users");

  // 只能看到自己的紀錄，或是已經被對方加入 sharing 名單的紀錄。
  // 不再允許任何登入過的人列出全部使用者（=登入碼），避免被列舉。
  collection.listRule = "id = @request.auth.id || sharing ~ @request.auth.username";
  collection.viewRule = "id = @request.auth.id || sharing ~ @request.auth.username";

  // 登入碼是這個 app 唯一的祕密，拉高最低長度以增加暴力猜測難度。
  collection.fields.getByName("username").min = 6;

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("users");

  collection.listRule = "@request.auth.id != ''";
  collection.viewRule = "@request.auth.id != ''";
  collection.fields.getByName("username").min = 3;

  app.save(collection);
})
