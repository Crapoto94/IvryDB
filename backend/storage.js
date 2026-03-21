const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const STORAGE_FILE = path.join(DATA_DIR, 'data.json');

const defaultData = {
  users: [
    {
      username: 'admin',
      password: 'admin123', // In a real app, this should be hashed
      connections: []
    }
  ]
};

const readData = () => {
  if (!fs.existsSync(STORAGE_FILE)) {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  const content = fs.readFileSync(STORAGE_FILE, 'utf8');
  return JSON.parse(content);
};

const writeData = (data) => {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
};

module.exports = { readData, writeData };
