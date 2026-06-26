/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("users");

  // appMode 欄位在前一筆 migration 儲存 collection 時意外消失，
  // 導致前端每次都偵測到「appMode 缺失」並嘗試補寫，
  // 但因欄位不存在於 schema，寫入永遠不會生效，造成無限重試的即時同步迴圈
  // （使用者畫面因此在日薪/月薪模式間不斷閃爍）。這裡把欄位加回來。
  collection.fields.add(new Field({
    id: "text_appMode",
    name: "appMode",
    type: "text",
    required: false,
    presentable: false,
    system: false,
    max: 50,
    min: 0,
    pattern: "",
    autogeneratePattern: "",
    hidden: false,
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("users");
  collection.fields.removeByName("appMode");
  app.save(collection);
})
