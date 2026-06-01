-- seed: 從 GAS 試算表匯出的現有資料
INSERT OR REPLACE INTO signups (id,created,type,start,weeks,day,name,img,goal,status) VALUES ('99582286-4c9b-4937-83bd-b23dcb44cd82',1780235973948,'once','2026-05-31',1,0,'小明','https://lh3.googleusercontent.com/d/1dZSvwYy0wK5CxQnc0tB8jcw_qKCPu3e9','測試','removed');
INSERT OR REPLACE INTO signups (id,created,type,start,weeks,day,name,img,goal,status) VALUES ('0fbe7419-9a14-4f73-951c-61541b7578ed',1780236233811,'once','2026-05-31',1,4,'改目標測試','','原本目標','removed');
INSERT OR REPLACE INTO signups (id,created,type,start,weeks,day,name,img,goal,status) VALUES ('612f9dfd-40f8-413a-ada4-55974356c39b',1780241208627,'once','2026-06-07',1,3,'未來測試','','','removed');
INSERT OR REPLACE INTO signups (id,created,type,start,weeks,day,name,img,goal,status) VALUES ('cf1692f2-b589-4671-a9dc-e74df1906e29',1780241704977,'nweeks','2026-05-31',4,0,'冠勉','https://lh3.googleusercontent.com/d/1BFgepQq2UOSDWvlDVjTeHuQVYrFEeeUR','工作順利','active');
INSERT OR REPLACE INTO signups (id,created,type,start,weeks,day,name,img,goal,status) VALUES ('2b7c3ec8-8856-4a19-abc2-5f74fddf2f4a',1780242592244,'fixed','2026-06-21',0,1,'冠勉','','','removed');
INSERT OR REPLACE INTO signups (id,created,type,start,weeks,day,name,img,goal,status) VALUES ('77eb2f10-106e-41ae-b746-369034ccea7f',1780319379545,'once','2026-05-31',1,1,'不具名','','明天個案會議溝通順利','active');
UPDATE prayer SET text='身心欠安同靈', updated=1780320957941 WHERE id=1;
