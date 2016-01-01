#!/bin/bash

sudo chown -R <%= appUser %> <%= appRemoteTargetPath %>

cd <%= appRemoteTargetPath %>
pm2 stop <%= appName %>

# unpack bundle / overwrite previous
tar -zxvf <%= appName %>.tar.gz
rm -rf <%= appName %>.tar.gz

# install npm dependencies
cd bundle/programs/server/
npm install

# restart daemon
#sudo systemctl daemon-reload
#sudo systemctl enable <%= appName %>.service
#sudo systemctl start <%= appName %>.service
cd <%= appRemoteTargetPath %>
echo "{\"apps\":[{\"name\":\"<%= appName %>\",\"script\":\"bundle/main.js\",\"log_date_format\":\"YYYY-MM-DD\",\"exec_mode\":\"fork_mode\",\"env\":{\"PORT\": \"<%= appPort %>\",\"MONGO_URL\": \"<%= appMongoUrl %>\",\"ROOT_URL\":\"<%= appRootUrl %>\"}}]}" > process.json
pm2 start process.json