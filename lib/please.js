var nodemiral = require('nodemiral-forcetty');
var path = require('path');
var fs = require('fs');
var cp = require('child_process');
var spawn = cp.spawn;
var prompt = require('prompt');
var Help = require('../lib/helpers');
require('colors');


var PATH_TO_CHROME = path.resolve(__dirname, '../chrome');
var PATH_TO_SCRIPTS = path.resolve(__dirname, '../scripts');
var PATH_TO_CONFS = path.resolve(__dirname, '../conf')
var PATH_TO_INIT_SCRIPT = path.resolve(PATH_TO_SCRIPTS, 'rh-setup-init.sh');
var PATH_TO_NODE_SCRIPT = path.resolve(PATH_TO_SCRIPTS, 'rh-setup-node.sh');
var PATH_TO_CHROME_INIT_SCRIPT = path.resolve(PATH_TO_SCRIPTS, 'rh-chrome.sh');
var PATH_TO_CHROME_SCRIPT = path.resolve(PATH_TO_SCRIPTS, 'rh-chrome-init.sh');
var PATH_TO_MONGO_SCRIPT = path.resolve(PATH_TO_SCRIPTS, 'rh-setup-mongo.sh');
var PATH_TO_NGINX_SCRIPT = path.resolve(PATH_TO_SCRIPTS, 'rh-setup-nginx.sh');
var PATH_TO_VHOST_SCRIPT = path.resolve(PATH_TO_SCRIPTS, 'rh-setup-vhost.sh');
var PATH_TO_BUILD_SCRIPT = path.resolve(PATH_TO_SCRIPTS, 'rh-build.sh');
var PATH_TO_DEPLOY_SCRIPT = path.resolve(PATH_TO_SCRIPTS, 'rh-deploy.sh');
var PATH_TO_NGINX_CONF = path.resolve(PATH_TO_CONFS, 'nginx.conf');
var PATH_TO_VHOST_CONF = path.resolve(PATH_TO_CONFS, 'vhost.conf');
var PATH_TO_SYSTEMD_CONF = path.resolve(PATH_TO_CONFS, 'noded.service');

module.exports = please;

function please (current_dir, config) {
	this.config = config;
	this.current_dir = current_dir;

	var verbosity = this.config.verbosity || false;
	this.verbosity = verbosity;
	var server = this.config.servers[0];
	var host = server.host;
	var auth = {username: server.username};
	var options = {
		verbose: verbosity,
		ssh: {'StrictHostKeyChecking': 'no', 'UserKnownHostsFile': '/dev/null'}
	};
	if(server.pem) {
		try {
			auth.pem = fs.readFileSync(path.resolve(server.pem), 'utf8');
		} catch (err) {
			if (err.code == 'ENOENT') {
				console.log('WARNING: SSH key does not exist!'.red);
			} else {
				console.error(err);
			}
		}
	} else {
		auth.password = server.password;
	}

	if(server.sshOptions) {
		for(var key in server.sshOptions) {
			options.ssh[key] = server.sshOptions[key];
		}
	}

	this.session = nodemiral.session(host, auth, options);

	var PATH_TO_SETTINGS_JSON = path.resolve(this.current_dir, 'settings.json');
	if (fs.existsSync(PATH_TO_SETTINGS_JSON)) {
		this.config.env['METEOR_SETTINGS'] = JSON.stringify(require(PATH_TO_SETTINGS_JSON));
	}
}
please.prototype.init = function () {
	var current_dir = this.current_dir;
	var PATH_TO_MPLZ_SETTINGS_JSON = path.resolve(this.current_dir, 'mplz.json');

	prompt.message = "[mplz.json]".magenta;
	prompt.start();
	if (fs.existsSync(PATH_TO_MPLZ_SETTINGS_JSON)) {
		// Already initialised
		prompt.get({properties: {
			continue: {
				description: "You've already initialised mplz in this project. Start over?",
				default: 'n',
				pattern: /^[YNyn\s]{1}$/
			}
		}}, function (err, res) {
			if (err) {
				return console.error(err);
			} else {
				var yesNo = {y: true, n: false, yes: true, no: false};
				if (yesNo[res.continue.toLowerCase()]) {
					continueWriteJson(current_dir);
				} else {
					return false;
				}
			}
		});
	}
	return false;
};

function continueWriteJson (cwd) {
	Help.initJson(cwd);
};

please.prototype.setup = function () {
	var taskList = nodemiral.taskList('Initialise RHEL environment.');

	// appDest - need to refactor this later
	var config_appName = this.config.appName;
	var config_appRootUrl = this.config.env.ROOT_URL || "127.0.0.1";
	var config_appUser = this.config.appUser || 'meteor-please';
	var config_appPort = this.config.env.PORT || "3000";
	var config_appSiteUrl = this.config.appSiteUrl.replace(/http:\/\//g, '') ;
	var config_appRemoteTargetPath = '/srv/www/' + config_appName;
	
	if(this.config.setupEpel){
		// Queue init script
		taskList.executeScript('Installing EPEL & build tools...', {
			script: PATH_TO_INIT_SCRIPT
		});	
	}

	// Queue nodejs install script
	if (this.config.setupNode) {
		taskList.executeScript('Installing nodejs...', {
			script: PATH_TO_NODE_SCRIPT,
			vars: {
				nodeVersion: this.config.nodeVersion
			}
		});
	}

	// Queue mongodb install script
	if (this.config.setupMongo) {
		taskList.executeScript('Installing mongodb*...', {
			script: PATH_TO_MONGO_SCRIPT
		});
	}

	// Queue nginx install script
	if (this.config.setupNginx) {
		taskList.executeScript('Installing nginx...', {
			script: PATH_TO_NGINX_SCRIPT,
		});
	}
	//Queue vhost config
	if(this.config.setupVhost){

		taskList.execute('Configuring installation directory...', {
			command: 'sudo mkdir -p /srv/www/' + config_appName + ' && sudo chown ' +config_appUser + ':' + config_appUser + ' /srv/www/'+config_appName
		});

		taskList.copy('Setting up nginx template...', {
			src: PATH_TO_VHOST_CONF,
			dest: '/srv/www/' + config_appName + '/vhost.conf'
		});

		if (this.config.sslcert) {
			taskList.copy('Installing SSL cert...', {
				src: path.resolve(this.config.sslcert),
				dest: '/etc/ssl/' + this.config.appSiteUrl + '.crt'
			});
			taskList.copy('Installing SSL key...', {
				src: path.resolve(this.config.sslkey),
				dest: '/etc/ssl/' + this.config.appSiteUrl + '.key'
			});
			taskList.copy('Setting up nginx with SSL...', {
				src: PATH_TO_NGINX_CONF,
				dest: '/etc/nginx/nginx.conf',
				vars: {
					appSiteUrl: this.config.appSiteUrl
				}
			});
		} else {
			taskList.executeScript('Configuring vhost and restarting nginx...', {
				script: PATH_TO_VHOST_SCRIPT,
				vars: {
					appSiteUrl: config_appSiteUrl,
					appName: config_appName,
					appPort : config_appPort,
					appDest: config_appRemoteTargetPath,
					appRemoteTargetPath: config_appRemoteTargetPath
				}
			});
		}
	}
	// Run task queue
	taskList.run(this.session);
};

please.prototype.chrome = function(){
	
	console.log(PATH_TO_CHROME_SCRIPT,PATH_TO_CHROME,this.config.appSiteUrl);

	var verbosity = this.verbosity;
	var thisSession = this.session;
	var self = this;

	console.log('[localhost]'.magenta + ' Building your app...');
	
	process.env.BUILD_OPTIONS = "--server "+this.config.appSiteUrl;
	process.env.PATH_TO_CHROME = PATH_TO_CHROME;

	var bash = spawn("bash", [PATH_TO_CHROME_INIT_SCRIPT], {cwd: this.config.app});
	
	bash.stdout.on('data', function (data) {
		if (verbosity) console.log(data.toString());


	});
	bash.stderr.on('data', function (data) {
		if (verbosity) console.log(data.toString());
	});
	bash.on('error', function (err) {
		console.log(err.message);
	})
	bash.on('close', function (code) {
		console.log('[localhost]'.magenta + ' Copying CSS and JS');

		fs.readdir(self.config.app+"/chrome/bundle/programs/web.browser",function(err,files){

			console.log(err,files);

			function endsWith(str, suffix) {
			    return str.indexOf(suffix, str.length - suffix.length) !== -1;
			}

			for(var i = 0 ; i < files.length; i ++){
				console.log('js')
				console.log(endsWith(files[i],'js'))
				console.log('css')
				console.log(endsWith(files[i],'css'))
			}

		});
	});

}
please.prototype.deploy = function () {
	// Deploy app to server
	console.log('[localhost]'.magenta + ' Building your app...');

	var taskList = nodemiral.taskList('Deploy ' + this.config.appName + ' to server.');

	// Queue local build + systemd setup
	var verbosity = this.verbosity;
	var thisSession = this.session;
	var config_app = this.config.app;
	var config_appName = this.config.appName;
	var config_nodeVersion = this.config.nodeVersion || '0.10.40';
	var config_appPort = this.config.env.PORT || "3000";
	var config_appRootUrl = this.config.env.ROOT_URL || "127.0.0.1";
	var config_mailUrl = this.config.env.MAIL_URL || "127.0.0.1";
	var config_appUser = this.config.appUser || 'meteor-please';
	var config_appRemoteTargetPath = '/srv/www/' + config_appName;
	var config_env_MONGO_URL = this.config.env.MONGO_URL;
	var config_bundleName = process.cwd().split('/').pop();
	var config_appEnv = this.config.env['METEOR_SETTINGS'];
	//console.log(config_appEnv);
	process.env.APP_NAME = this.appUser;
	process.env.APP_LOCAL_PATH = this.config.app;
	process.env.BUILD_OPTIONS = "--architecture os.linux.x86_64 --server "+this.config.appSiteUrl;

	var bash = spawn("bash", [PATH_TO_BUILD_SCRIPT], {cwd: this.config.app});
	bash.stdout.on('data', function (data) {
		if (verbosity) console.log(data.toString());
	});
	bash.stderr.on('data', function (data) {
		if (verbosity) console.log(data.toString());
	});
	bash.on('error', function (err) {
		console.log(err.message);
	})
	bash.on('close', function (code) {
		if (code) {
			// BUILD ERROR!
			console.error('Error while building: ' + code);
		} else {
			// BUILD SUCCESS!!!
			// scp bundle to server
			taskList.execute('Configuring installation directory...', {
				command: 'sudo mkdir -p /srv/www/' + config_appName + ' && sudo chown ' +config_appUser + ':' + config_appUser + ' /srv/www/'+config_appName
			});
			
			console.log({
				src: config_app + '/bundle/' + config_bundleName + '.tar.gz',
				dest: config_appRemoteTargetPath + '/' + config_appName + '.tar.gz'
			});

			taskList.copy('Uploading bundle...', {
				src: config_app + '/bundle/' + config_bundleName + '.tar.gz',
				dest: config_appRemoteTargetPath + '/' + config_appName + '.tar.gz'
			});
			/*
			// scp the systemd template to server
			taskList.copy('Configuring systemd daemon...', {
				src: PATH_TO_SYSTEMD_CONF,
				dest: '/etc/systemd/system/' + config_appName + '.service',
				vars: {
					appRootUrl: config_appRootUrl,
					appPort: config_appPort,
					appMongoUrl: config_env_MONGO_URL || ('mongodb://127.0.0.1:27017/' + config_appName),
					appUser: config_appUser || 'meteor-please',
					appName: config_appName,
					appEnv: config_appEnv
				}
			});
			*/
			// run deploy script on server
			taskList.executeScript('Deploying bundle...', {
				script: PATH_TO_DEPLOY_SCRIPT,
				vars: {
					appName: config_appName,
					appUser: config_appUser,
					appRemoteTargetPath: config_appRemoteTargetPath,
					appRootUrl: config_appRootUrl,
					mailUrl: config_mailUrl,
					appPort: config_appPort,
					nodeVersion : config_nodeVersion,
					interpreter : '/home/'+config_appUser+'/.nvm/versions/node/'+config_nodeVersion+'/bin/node',
					appMongoUrl: config_env_MONGO_URL || ('mongodb://127.0.0.1:27017/' + config_appName),
					appUser: config_appUser || 'meteor-please',
					appName: config_appName,
					appEnv: config_appEnv
				}
			});
			// send restart to nginx daemon
			taskList.execute('Restarting nginx... ', {
				command: 'sudo systemctl restart nginx'
			});
			taskList.run(thisSession);
		}
	});
};

please.prototype.reconfig = function () {
	var taskList = nodemiral.taskList('Reconfigure app');

	// appDest - need to refactor this later
	var config_appName = this.config.appName;
	var config_appRemoteTargetPath = '/srv/www/' + config_appName + '/bundle/programs/web.browser/app/';
	var config_appPort = this.config.env.PORT || "3000";
	var config_appRootUrl = this.config.env.ROOT_URL || "127.0.0.1";

	// resend systemd, nginx configs
	// scp the systemd template to server
	taskList.copy('Reconfiguring systemd daemon...', {
		src: PATH_TO_SYSTEMD_CONF,
		dest: '/etc/systemd/system/' + this.config.appName + '.service',
		vars: {
			appRootUrl: config_appRootUrl,
			appPort: config_appPort,
			appMongoUrl: this.config.env.MONGO_URL || ('mongodb://127.0.0.1:27017/' + this.config.appName),
			appUser: this.config.appUser || 'meteor-please',
			appName: this.config.appName,
			appEnv: this.config.env['METEOR_SETTINGS']
		}
	});
	// scp the nginx template to server
	taskList.copy('Reconfiguring nginx...', {
			src: PATH_TO_NGINX_CONF,
			dest: '/etc/nginx/nginx.conf',
			vars: {
				appSiteUrl: this.config.appSiteUrl,
				appDest: config_appRemoteTargetPath
			}
		});
	// reload systemd
	taskList.execute('Reloading systemd...', {
		command: 'sudo systemctl daemon-reload'
	});
	// send restart to nginx daemon
	taskList.execute('Restarting nginx... ', {
		command: 'sudo systemctl restart nginx'
	});

	taskList.run(this.session);
};

please.prototype.stop = function () {
	var taskList = nodemiral.taskList('Stop app');
	// send stop to systemd
	taskList.execute('Stopping ' + this.config.appName + ' daemon...', {
		command : 'pm2 stop '+ this.config.appName
	});

	taskList.run(this.session);
};

please.prototype.start = function () {
	var taskList = nodemiral.taskList('Start app');
	// send start to systemd
	taskList.execute('Starting ' + this.config.appName + ' daemon...', {
		command : 'pm2 start '+ this.config.appName
	});

	taskList.run(this.session);
};

please.prototype.restart = function () {
	var taskList = nodemiral.taskList('Restart app');
	// send restart to systemd
	taskList.execute('Restarting ' + this.config.appName + ' daemon...', {
		command : 'pm2 restart '+ this.config.appName
		//command: 'sudo systemctl restart ' + this.config.appName + '.service'
	});
	// send restart to nginx daemon
	taskList.execute('Restarting nginx... ', {
		command: 'sudo systemctl restart nginx'
	});
	taskList.run(this.session);
};

please.prototype.reboot = function () {
	var taskList = nodemiral.taskList('Reboot SSH machine (this will error)');
	// send reboot to ssh
	taskList.execute('Rebooting machine...', {
		command: 'sudo reboot'
	});

	taskList.run(this.session);
};

please.prototype.delete = function () {
	var taskList = nodemiral.taskList('Delete app from deployment server');
	// delete!!
	taskList.execute('Removing app files...', {
		command: 'sudo rm -rf /srv/www/' + this.config.appName
	});

	taskList.execute('Removing daemon...', {
		commang: 'pm2 delete' + this.config.appName
	});

	taskList.execute('Removing vhost...', {
		command: 'sudo rm -rf /etc/nginx/conf.d/' + this.config.appName + '.conf'
	});
	// send restart to nginx daemon
	taskList.execute('Restarting nginx... ', {
		command: 'sudo systemctl restart nginx'
	});
	taskList.run(this.session);
};