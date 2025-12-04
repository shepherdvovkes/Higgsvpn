#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = 'shepherdvovkes';
const REPO_NAME = 'higgsvpn';

if (!GITHUB_TOKEN) {
  console.error('❌ Error: GITHUB_TOKEN environment variable is required');
  console.error('   Please create a GitHub Personal Access Token with "repo" and "admin:public_key" permissions');
  console.error('   Then run: $env:GITHUB_TOKEN="your_token"; node setup-github-repo.js');
  process.exit(1);
}

// Read public key
const publicKeyPath = path.join(__dirname, '.deploy_key.pub');
if (!fs.existsSync(publicKeyPath)) {
  console.error('❌ Error: Deploy key not found at .deploy_key.pub');
  process.exit(1);
}

const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();

function makeRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, data: parsed });
          } else {
            reject({ statusCode: res.statusCode, data: parsed, message: parsed.message || body });
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, data: body });
          } else {
            reject({ statusCode: res.statusCode, message: body });
          }
        }
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function createRepository() {
  console.log(`📦 Creating repository: ${USERNAME}/${REPO_NAME}...`);

  const options = {
    hostname: 'api.github.com',
    path: '/user/repos',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Node.js'
    }
  };

  const data = {
    name: REPO_NAME,
    description: 'Higgs VPN - Decentralized VPN Network',
    private: false
  };

  try {
    const response = await makeRequest(options, data);
    console.log('✅ Repository created successfully!');
    console.log(`   URL: ${response.data.html_url}`);
    return response.data;
  } catch (error) {
    if (error.statusCode === 422 && error.message?.includes('already exists')) {
      console.log('⚠️  Repository already exists, continuing...');
      return { html_url: `https://github.com/${USERNAME}/${REPO_NAME}` };
    }
    throw error;
  }
}

async function addDeployKey() {
  console.log('\n🔑 Adding deploy key to repository...');

  const options = {
    hostname: 'api.github.com',
    path: `/repos/${USERNAME}/${REPO_NAME}/keys`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Node.js'
    }
  };

  const data = {
    title: 'Deploy Key - Higgs VPN',
    key: publicKey,
    read_only: false
  };

  try {
    const response = await makeRequest(options, data);
    console.log('✅ Deploy key added successfully!');
    console.log(`   Key ID: ${response.data.id}`);
    return response.data;
  } catch (error) {
    if (error.statusCode === 422 && error.message?.includes('already exists')) {
      console.log('⚠️  Deploy key might already exist, continuing...');
      return;
    }
    throw error;
  }
}

async function main() {
  try {
    await createRepository();
    await addDeployKey();
    
    console.log('\n✨ Setup complete!');
    console.log(`\n📋 Next steps:`);
    console.log(`   1. git init`);
    console.log(`   2. git remote add origin git@github.com:${USERNAME}/${REPO_NAME}.git`);
    console.log(`   3. git config core.sshCommand "ssh -i .deploy_key -F NUL"`);
    console.log(`   4. git add .`);
    console.log(`   5. git commit -m "Initial commit"`);
    console.log(`   6. git push -u origin main`);
  } catch (error) {
    console.error('\n❌ Error:', error.message || error);
    if (error.data) {
      console.error('   Details:', JSON.stringify(error.data, null, 2));
    }
    process.exit(1);
  }
}

main();

