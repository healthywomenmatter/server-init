#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Dynamic imports loader
async function loadDependencies() {
  try {
    // Force clean stdout for spinner
    process.stdout.write('\x1B[?25l'); // Hide cursor
    
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const inquirer = (await import('inquirer')).default;
    
    // Configure ora to use force-spin even in CI environments
    const spinner = ora({
      isEnabled: true,
      text: 'Loading',
      spinner: 'dots',
      color: 'cyan',
      hideCursor: true,
      indent: 1
    });

    return {
      chalk,
      ora: spinner.constructor, // Return ora class instead of default
      inquirer,
      theme: {
        success: chalk.greenBright,
        error: chalk.redBright,
        warning: chalk.yellowBright,
        info: chalk.cyanBright,
        highlight: chalk.magentaBright
      }
    };
  } catch (error) {
    process.stdout.write('\x1B[?25h'); // Ensure cursor is restored
    console.error('Failed to load dependencies:', error);
    process.exit(1);
  }
}

// Helper functions
function getRecentNodeVersions() {
  return [
    '20.14.0',  // Current LTS
    '18.20.2',  // Maintenance LTS
    '16.20.2',  // Maintenance LTS
    '21.7.3',   // Latest release
    '20.13.1'   // Previous minor
  ];
}

async function installBaseDependencies() {
  const { ora, theme } = await loadDependencies();
  const spinner = new ora({ text: theme.info('Installing base dependencies')}).start();
  await new Promise(resolve => setTimeout(resolve, 100));
  try {
    execSync('sudo apt-get update -qq', { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
    execSync('sudo apt-get install -y -qq curl git nginx', { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
    spinner.succeed();
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

async function installNodeWithNVM(version) {
  const { ora, theme } = await loadDependencies();
  const spinner = new ora({ text: theme.info(`Installing Node.js ${version} with NVM`)}).start();
  await new Promise(resolve => setTimeout(resolve, 100));
  try {
    execSync('curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash', { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
    
    const installCmd = [
      `source ${os.homedir()}/.nvm/nvm.sh`,
      `nvm install ${version}`,
      `nvm alias default ${version}`,
      'npm install -g pm2'
    ].join(' && ');
    
    execSync(`bash -c "${installCmd}"`, { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
    spinner.succeed();
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

async function installPackageManager(manager) {
  const { ora, theme } = await loadDependencies();
  const spinner = new ora({ text: theme.info(`Installing ${manager}`)}).start();
  await new Promise(resolve => setTimeout(resolve, 100));
  try {
    if (manager !== 'npm') {
      execSync(`npm install -g ${manager}`, { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
    }
    spinner.succeed();
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

async function generateSSHKeys(repoUrl) {
  const { ora, theme } = await loadDependencies();
  const spinner = new ora({ text: theme.info('Generating SSH keys')}).start();
  await new Promise(resolve => setTimeout(resolve, 100));
  try {
    const keyName = `id_${Date.now()}`;
    const keyPath = path.join(os.homedir(), '.ssh', keyName);
    
    execSync(`ssh-keygen -t ed25519 -f ${keyPath} -N "" -q`);
    execSync(`chmod 600 ${keyPath}`);

    spinner.succeed();
    return {
      publicKeyPath: `${keyPath}.pub`,
      privateKeyPath: keyPath
    };
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

async function installPHP(version) {
  const { ora, theme } = await loadDependencies();
  const spinner = new ora({ text: theme.info(`Installing PHP ${version}`)}).start();
  await new Promise(resolve => setTimeout(resolve, 100));
  try {
    execSync('sudo add-apt-repository -y ppa:ondrej/php', { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
    execSync('sudo apt-get update -qq', { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
    execSync(`sudo apt-get install -y -qq php${version} php${version}-fpm`, { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
    spinner.succeed();
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

async function installPHPExtensions(version) {
  const { ora, theme } = await loadDependencies();
  const spinner = new ora({ text: theme.info('Installing PHP extensions')}).start();
  await new Promise(resolve => setTimeout(resolve, 100));
  try {
    const extensions = [
      'cli', 'common', 'curl', 'gd',
      'mbstring', 'mysql', 'pdo', 'xml',
      'zip', 'bcmath', 'opcache', 'intl'
    ];

    const installCmd = extensions.map(ext => 
      `php${version}-${ext}`
    ).join(' ');
    
    execSync(`sudo apt-get install -y -qq ${installCmd}`);
    spinner.succeed();
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

async function setupNginx(answers) {
  const { ora, theme } = await loadDependencies();
  const spinner = new ora({ text: theme.info('Configuring Nginx')}).start();
  await new Promise(resolve => setTimeout(resolve, 100));
  try {
    const configPath = `/etc/nginx/sites-available/${answers.domain || 'app'}`;
    let configContent;

    if (answers.appType === 'php') {
      configContent = `
server {
    listen 80;
    server_name ${answers.domain || '_'};
    root ${answers.cloneDir}/live;

    index index.php index.html index.htm;

    location / {
        try_files $uri $uri/ =404;
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php${answers.phpVersion}-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }
}`;
    } else {
      configContent = `
server {
    listen 80;
    server_name ${answers.domain || '_'};

    location / {
        proxy_pass http://localhost:${answers.nodePort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}`;
    }

    fs.writeFileSync(configPath, configContent);
    execSync(`sudo ln -sf ${configPath} /etc/nginx/sites-enabled/`);
    execSync('sudo rm -f /etc/nginx/sites-enabled/default');
    execSync('sudo nginx -t');
    execSync('sudo systemctl stop nginx && sudo kill $(sudo lsof -t -i :80) || true');
    execSync('sudo systemctl restart nginx', { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
    spinner.succeed();
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

async function runCertbot(domain) {
  const { ora, theme } = await loadDependencies();
  await new Promise(resolve => setTimeout(resolve, 100));
  execSync('sudo systemctl restart nginx && sudo kill $(sudo lsof -t -i :80) || true');
  try {
    const spinner = new ora({ text: theme.info('Installing Certbot')}).start();
    await new Promise(resolve => setTimeout(resolve, 100));
    execSync(`sudo apt-get install certbot -y -qq`, { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
    spinner.succeed();
    const spinner2 = new ora({ text: theme.info('Installing Certbot Nginx plugin')}).start();
    await new Promise(resolve => setTimeout(resolve, 100));
    execSync(`sudo apt-get install python3-certbot-nginx -y -qq`, { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
    spinner2.succeed();
    const spinner3 = new ora({ text: theme.info('Requesting Let\'s Encrypt SSL Certificate')}).start();
    await new Promise(resolve => setTimeout(resolve, 100));
    execSync(`sudo certbot --nginx -n -d ${domain} --agree-tos --email admin@${domain} --redirect`, { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
    spinner3.succeed();
    execSync('sudo systemctl stop nginx && sudo kill $(sudo lsof -t -i :80) && systemctl restart nginx || true', { 
      stdio: ['ignore', 'ignore', process.stderr] // Allow output but keep spinner
    });
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

/**
 * Clone a Git repository into a timestamped subdirectory and update symlink
 * @param {string} repoUrl - Git repository URL
 * @param {string} cloneDir - Base directory where symlink lives
 * @param {string} privateKeyPath - Path to SSH private key
 */
async function cloneRepo(repoUrl, cloneDir, privateKeyPath) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:T]/g, '-')
    .replace(/\.\d+Z$/, ''); // yy-mm-dd-hh-mm-ss

  const targetDir = path.join(cloneDir, timestamp);
  const { ora, theme } = await loadDependencies();
  const spinner = new ora({ text: theme.info('Cloning repository') }).start();

  try {
    // Ensure base directory exists
    fs.mkdirSync(cloneDir, { recursive: true });
    // Clone into timestamped directory
    execSync(
      `GIT_SSH_COMMAND='ssh -i ${privateKeyPath} -o StrictHostKeyChecking=no' ` +
      `git clone ${repoUrl} ${targetDir}`,
      { stdio: 'inherit', shell: true }
    );

    // Update symlink: remove old and create new
    const linkPath = path.join(cloneDir, "live");
    // Remove existing symlink if it exists
    try {
      const stats = fs.lstatSync(linkPath);
      if (stats.isSymbolicLink() || stats.isDirectory()) {
        fs.unlinkSync(linkPath);
      }
    } catch (err) {
      // ignore if link does not exist
    }
    // Create symlink pointing to new clone
    fs.symlinkSync(targetDir, linkPath, 'dir');

    spinner.succeed(theme.success(`Repository cloned to ${targetDir}`));
    return { targetDir };
  } catch (error) {
    spinner.fail(theme.error('Failed to clone repository'));
    throw error;
  }
}

async function setupNodeApp(answers) {
  const { ora, theme } = await loadDependencies();
  const spinner = new ora({ text: theme.info('Setting up Node.js application')}).start();
  await new Promise(resolve => setTimeout(resolve, 100));
  try {
    process.chdir(answers.cloneDir);
    
    const pm = answers.pkgManager;
    const installCmd = pm === 'yarn' ? 'yarn' : `${pm} install`;
    const buildCmd = pm === 'yarn' ? 'yarn build' : `${pm} run build`;
    const startCmd = pm === 'yarn' ? `yarn ${answers.useDev ? 'dev' : 'start'}` 
      : `${pm} run ${answers.useDev ? 'dev' : 'start'}`;

    execSync(installCmd, { stdio: 'inherit' });
    
    if (answers.shouldBuild) {
      execSync(buildCmd, { stdio: 'inherit' });
    }

    execSync(`pm2 start ${startCmd} --name "${path.basename(answers.cloneDir)}"`);
    execSync('pm2 save');
    execSync('pm2 startup');
    
    spinner.succeed();
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

// Main function
async function main() {
  const { chalk, ora, inquirer, theme } = await loadDependencies();

  console.log(theme.info(`
███████╗███████╗████████╗██╗   ██╗██████╗ 
██╔════╝██╔════╝╚══██╔══╝██║   ██║██╔══██╗
███████╗█████╗     ██║   ██║   ██║██████╔╝
╚════██║██╔══╝     ██║   ██║   ██║██╔═══╝ 
███████║███████╗   ██║   ╚██████╔╝██║     
╚══════╝╚══════╝   ╚═╝    ╚═════╝ ╚═╝     
`));

  try {
    if (process.getuid() !== 0) {
      console.log(theme.error('Please run this script with sudo!'));
      process.exit(1);
    }

    await installBaseDependencies();

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'domain',
        message: 'Enter domain name (optional):',
        default: ''
      },
      {
        type: 'list',
        name: 'appType',
        message: 'Select application type:',
        choices: ['php', 'nodejs']
      },
      {
        type: 'input',
        name: 'phpVersion',
        message: 'Enter PHP version to install:',
        default: '8.2',
        when: (answers) => answers.appType === 'php'
      },
      {
        type: 'list',
        name: 'nodeVersion',
        message: 'Select Node.js version:',
        choices: getRecentNodeVersions(),
        pageSize: 7,
        when: (answers) => answers.appType === 'nodejs'
      },
      {
        type: 'list',
        name: 'pkgManager',
        message: 'Select package manager:',
        choices: ['npm', 'yarn', 'pnpm'],
        default: 'npm',
        when: (answers) => answers.appType === 'nodejs'
      },
      {
        type: 'input',
        name: 'nodePort',
        message: 'Enter Node.js application port:',
        default: '3000',
        when: (answers) => answers.appType === 'nodejs'
      },
      {
        type: 'input',
        name: 'repoUrl',
        message: 'Enter Git repository URL:'
      },
      {
        type: 'input',
        name: 'cloneDir',
        message: 'Enter directory to clone repository:',
        default: '/var/www/app'
      },
      {
        type: 'confirm',
        name: 'shouldBuild',
        message: 'Run build process?',
        default: true,
        when: (answers) => answers.appType === 'nodejs'
      },
      {
        type: 'confirm',
        name: 'useDev',
        message: 'Run in development mode?',
        default: false,
        when: (answers) => answers.appType === 'nodejs'
      }
    ]);

    const { publicKeyPath, privateKeyPath } = await generateSSHKeys(answers.repoUrl);

    if (answers.appType === 'php') {
      await installPHP(answers.phpVersion);
      await installPHPExtensions(answers.phpVersion);
    } else {
      await installNodeWithNVM(answers.nodeVersion);
      await installPackageManager(answers.pkgManager);
    }

    await setupNginx(answers);

    if (answers.domain) {
      await runCertbot(answers.domain);
    }
    console.log(theme.highlight('\nNext steps:'));
    console.log(`1. Add this public key to your repo deploy keys:\n${fs.readFileSync(publicKeyPath)}`);
    console.log(`2. Add this private key to your CI/CD secrets:\n${privateKeyPath}`);
    const askIfDone = await inquirer.prompt({
      type: 'input',
      name: 'added',
      message: 'Are you done adding the key? (yes/no):'
    });
    if (askIfDone.added === 'yes') {
      await cloneRepo(answers.repoUrl, answers.cloneDir, privateKeyPath);
      if (answers.appType === 'nodejs') {
        await setupNodeApp(answers);
      }
      execSync(`./setup-mysql.js ${answers.cloneDir}`, { stdio: 'inherit' });
    }

    console.log(theme.success('\n✅ Setup completed successfully!'));
    if (answers.domain) {
      console.log(`3. Visit https://${answers.domain} in your browser`);
    }

  } catch (error) {
    console.error(theme.error('\n❌ Error during setup:'), error);
    process.exit(1);
  }
}

main();