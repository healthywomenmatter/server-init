#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

async function loadDependencies() {
  try {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const inquirer = (await import('inquirer')).default;
    
    return {
      chalk,
      ora,
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
    console.error('Failed to load dependencies:', error);
    process.exit(1);
  }
}

async function installMySQL() {
  const { ora, theme } = await loadDependencies();
  const spinner = ora(theme.info('Installing MySQL server')).start();
  try {
    // Install MySQL server
    execSync('sudo apt-get install -y -qq mysql-server');
    spinner.succeed();
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

async function setRootPassword(password) {
  return;
  const { ora, theme } = await loadDependencies();
  const spinner = ora(theme.info('Setting MySQL root password')).start();
  
  try {
    // Stop MySQL if it's running
    execSync('sudo systemctl stop mysql || true', { stdio: 'ignore' });
    execSync('sudo pkill -9 mysqld || true', { stdio: 'ignore' });
    execSync('sleep 2');

    // Create init file with more complete setup
    const initFile = '/tmp/mysql-init.sql';
    fs.writeFileSync(initFile, `
      SET PASSWORD FOR 'root'@'localhost' = PASSWORD('${password}');
      UPDATE mysql.user SET plugin='mysql_native_password' WHERE User='root';
      DELETE FROM mysql.user WHERE User='';
      DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');
      DROP DATABASE IF EXISTS test;
      DELETE FROM mysql.db WHERE Db='test' OR Db='test\\_%';
      FLUSH PRIVILEGES;
    `);

    // Create a minimal my.cnf file to keep MySQL running
    const myCnf = '/tmp/my.cnf';
    fs.writeFileSync(myCnf, `
      [mysqld]
      user=mysql
      pid-file=/var/run/mysqld/mysqld.pid
      socket=/var/run/mysqld/mysqld.sock
      datadir=/var/lib/mysql
      log-error=/var/log/mysql/error.log
    `);

    // Start MySQL with both init file and config
    execSync(`sudo mysqld --defaults-file=${myCnf} --init-file=${initFile} --daemonize`, { stdio: 'ignore' });

    // Wait for MySQL to be ready
    let attempts = 0;
    while (attempts < 10) {
      try {
        execSync(`sudo mysqladmin ping -uroot -p${password} 2>/dev/null`, { stdio: 'ignore' });
        break;
      } catch {
        attempts++;
        execSync('sleep 2');
      }
    }

    if (attempts >= 10) {
      throw new Error('MySQL failed to start with new password');
    }

    // Verify the password works
    execSync(`sudo mysql -uroot -p${password} -e "SELECT 1"`, { stdio: 'ignore' });

    // Stop the temporary instance
    execSync(`sudo mysqladmin shutdown -uroot -p${password}`, { stdio: 'ignore' });

    // Start MySQL normally through systemd
    execSync('sudo systemctl start mysql', { stdio: 'ignore' });

    // Final verification
    execSync(`sudo mysql -uroot -p${password} -e "SELECT 1"`, { stdio: 'ignore' });

    // Clean up
    fs.unlinkSync(initFile);
    fs.unlinkSync(myCnf);

    spinner.succeed();
  } catch (error) {
    spinner.fail();
    console.error(theme.error('\nMySQL error log:'));
    try {
      console.log(fs.readFileSync('/var/log/mysql/error.log', 'utf8'));
    } catch (e) {
      console.log('Could not read error log');
    }
    throw error;
  }
}

async function promptForEnvPath(repoPath) {
  const { inquirer, theme } = await loadDependencies();
  
  console.log(theme.warning('\n⚠️  .env files are typically not version controlled'));
  console.log(theme.info('Please provide the path to your .env file if you have one ready'));

  const response = await inquirer.prompt([
    {
      type: 'input',
      name: 'envPath',
      message: 'Path to your .env file (or leave blank to create new):',
      default: `${repoPath}/.env`,
      validate: (input) => {
        if (!input) return true;
        const fullPath = path.isAbsolute(input) ? input : path.join(repoPath, input);
        return fs.existsSync(fullPath) || 'File does not exist';
      }
    }
  ]);

  return response.envPath 
    ? (path.isAbsolute(response.envPath) ? response.envPath : path.join(repoPath, response.envPath))
    : null;
}

function parseMySQLCredentials(envPath) {
  try {
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    
    const possibleKeys = {
      user: ['DB_USERNAME', 'MYSQL_USER', 'DATABASE_USER', 'DB_USER'],
      password: ['DB_PASSWORD', 'MYSQL_PASSWORD', 'DATABASE_PASSWORD', 'DB_PASSWORD'],
      database: ['DB_DATABASE', 'MYSQL_DATABASE', 'DATABASE_NAME', 'DB_NAME']
    };

    const credentials = {};
    
    for (const [type, keys] of Object.entries(possibleKeys)) {
      for (const key of keys) {
        if (envConfig[key]) {
          credentials[type] = envConfig[key];
          break;
        }
      }
    }

    return Object.keys(credentials).length === 3 ? credentials : null;
  } catch (error) {
    return null;
  }
}

async function configureMySQL(credentials, repoPath, rootPassword) {
  const { ora, theme, inquirer } = await loadDependencies();
  const spinner = ora(theme.info('Configuring MySQL')).start();
  
  try {
    if (!credentials) {
      spinner.stop();
      
      // Use inquirer.prompt directly without wrapping
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'user',
          message: 'MySQL username:',
          default: 'app_user'
        },
        {
          type: 'password',
          name: 'password',
          message: 'MySQL password (min 12 chars):',
          mask: '*',
          validate: input => input.length >= 12 || 'Password must be at least 12 characters'
        },
        {
          type: 'input',
          name: 'database',
          message: 'Database name:',
          default: path.basename(repoPath).replace(/[^a-z0-9_]/gi, '_').toLowerCase()
        }
      ]);
      
      credentials = answers;
      spinner.start();
    }

    // Execute MySQL commands without hanging
    const sqlCommands = [
      `CREATE DATABASE IF NOT EXISTS ${credentials.database};`,
      `CREATE USER IF NOT EXISTS '${credentials.user}'@'localhost' IDENTIFIED BY '${credentials.password}';`,
      `GRANT ALL PRIVILEGES ON ${credentials.database}.* TO '${credentials.user}'@'localhost';`,
      'FLUSH PRIVILEGES;'
    ].join(' ');

    execSync(`sudo mysql -uroot -p${rootPassword} -e "${sqlCommands}"`, {
      stdio: ['ignore', 'ignore', 'ignore']
    });

    // Handle .env file updates
    const envPath = path.join(repoPath, '.env');
    const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    
    const envLines = envContent.split('\n').filter(line => 
      !line.startsWith('DB_')
    );

    envLines.push(
      'DB_CONNECTION=mysql',
      'DB_HOST=127.0.0.1',
      'DB_PORT=3306',
      `DB_DATABASE=${credentials.database}`,
      `DB_USERNAME=${credentials.user}`,
      `DB_PASSWORD=${credentials.password}`
    );

    fs.writeFileSync(envPath, envLines.join('\n'));
    execSync(`chmod 600 ${envPath}`);

    // Properly handle SQL import prompt
    spinner.stop();
    await promptForSQLImport(credentials.database, rootPassword);
    spinner.succeed();

    return credentials;
  } catch (error) {
    spinner.fail();
    throw error;
  }
}

async function promptForSQLImport(database, rootPassword) {
  const { inquirer, theme } = await loadDependencies();

  // Clear any buffered input
  // process.stdin.pause();
  // process.stdin.removeAllListeners('data');

  try {
    const response = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'importSQL',
        message: 'Do you want to import an SQL file?',
        default: false,
        validate: async (input) => {
          // Add small delay to ensure prompt renders properly
          await new Promise(resolve => setTimeout(resolve, 100));
          return true;
        }
      },
      {
        type: 'input',
        name: 'sqlPath',
        message: 'Path to SQL file to import:',
        when: (answers) => answers.importSQL,
        validate: (input) => {
          if (!input) return 'Please provide a path';
          const fullPath = path.isAbsolute(input) ? input : path.join(process.cwd(), input);
          return fs.existsSync(fullPath) || 'File does not exist';
        }
      }
    ]);

    if (response.importSQL) {
      const fullPath = path.isAbsolute(response.sqlPath) 
        ? response.sqlPath 
        : path.join(process.cwd(), response.sqlPath);
      
      console.log(theme.info(`\nImporting SQL file to database ${database}...`));
      execSync(`sudo mysql -uroot -p${rootPassword} ${database} < ${fullPath}`, { 
        stdio: ['ignore', 'inherit', 'ignore'] 
      });
      console.log(theme.success('SQL import completed!'));
    }
  } finally {
    // Ensure stdin is properly reset
    // process.stdin.resume();
  }
}

async function main(repoPath) {
  const { theme } = await loadDependencies();
  
  try {
    console.log(theme.info('\n🚀 Starting MySQL setup...'));

    // 1. Install MySQL
    await installMySQL();

    // 2. Set root password
    const rootPassword = 'toor'; // Or generate a random one
    await setRootPassword(rootPassword);

    // 3. Continue with configuration
    const envPath = await promptForEnvPath(repoPath);
    let credentials = null;

    if (envPath) {
      console.log(theme.highlight(`\n🔍 Using .env file at ${envPath}`));
      credentials = parseMySQLCredentials(envPath);
      
      if (!credentials) {
        console.log(theme.warning('⚠️  No valid MySQL credentials found in .env file'));
      }
    }

    const finalCredentials = await configureMySQL(credentials, repoPath, rootPassword);

    console.log(theme.success('\n✅ MySQL setup completed successfully!'));
    console.log(theme.info('\nDatabase credentials:'));
    console.log(`- Database: ${finalCredentials.database}`);
    console.log(`- Username: ${finalCredentials.user}`);
    console.log(`- Password: ${'*'.repeat(finalCredentials.password.length)}`);
    console.log(theme.highlight('\nThese credentials have been saved to your .env file'));
  } catch (error) {
    console.error(theme.error('\n❌ Error during MySQL setup:'), error);
    process.exit(1);
  }
}

const repoPath = process.argv[2] || process.cwd();
main(repoPath);