const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// مكتبات بايثون القياسية (موجودة جاهزة، ما لازم نثبتها)
const STDLIB_MODULES = new Set([
  'abc', 'argparse', 'array', 'ast', 'asyncio', 'base64', 'bisect', 'calendar',
  'cmd', 'code', 'codecs', 'collections', 'colorsys', 'concurrent', 'configparser',
  'contextlib', 'contextvars', 'copy', 'copyreg', 'csv', 'ctypes', 'curses',
  'dataclasses', 'datetime', 'decimal', 'difflib', 'dis', 'distutils', 'doctest',
  'enum', 'errno', 'faulthandler', 'fcntl', 'filecmp', 'fileinput', 'fnmatch',
  'fractions', 'ftplib', 'functools', 'gc', 'getopt', 'getpass', 'gettext', 'glob',
  'graphlib', 'grp', 'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'http', 'idlelib',
  'imaplib', 'imghdr', 'imp', 'importlib', 'inspect', 'io', 'ipaddress', 'itertools',
  'json', 'keyword', 'lib2to3', 'linecache', 'locale', 'logging', 'lzma', 'mailbox',
  'mailcap', 'marshal', 'math', 'mimetypes', 'mmap', 'modulefinder', 'multiprocessing',
  'netrc', 'nis', 'nntplib', 'numbers', 'operator', 'optparse', 'os', 'ossaudiodev',
  'parser', 'pathlib', 'pdb', 'pickle', 'pickletools', 'pipes', 'pkgutil', 'platform',
  'plistlib', 'poplib', 'posix', 'posixpath', 'pprint', 'profile', 'pstats', 'pty',
  'pwd', 'py_compile', 'pyclbr', 'pydoc', 'pydoc_data', 'pytz', 'queue', 'quopri',
  'random', 're', 'readline', 'reprlib', 'resource', 'rlcompleter', 'runpy', 'sched',
  'secrets', 'select', 'selectors', 'shelve', 'shlex', 'shutil', 'signal', 'site',
  'smtpd', 'smtplib', 'sndhdr', 'socket', 'socketserver', 'spwd', 'sqlite3', 'ssl',
  'stat', 'statistics', 'string', 'stringprep', 'struct', 'subprocess', 'sunau',
  'symtable', 'sys', 'sysconfig', 'syslog', 'tabnanny', 'tarfile', 'telnetlib',
  'tempfile', 'termios', 'test', 'textwrap', 'threading', 'time', 'timeit',
  'tkinter', 'token', 'tokenize', 'tomllib', 'trace', 'traceback', 'tracemalloc',
  'tty', 'turtle', 'turtledemo', 'types', 'typing', 'unicodedata', 'unittest',
  'urllib', 'uu', 'uuid', 'venv', 'warnings', 'wave', 'weakref', 'webbrowser',
  'winreg', 'winsound', 'wsgiref', 'xdrlib', 'xml', 'xmlrpc', 'zipapp', 'zipfile',
  'zipimport', 'zlib', 'zoneinfo', '__future__',
]);

// خريطة بين اسم الموديول واسم الحزمة على PyPI (لو مختلف)
const PIP_NAME_MAP = {
  'PIL': 'Pillow',
  'cv2': 'opencv-python-headless',
  'sklearn': 'scikit-learn',
  'skimage': 'scikit-image',
  'yaml': 'PyYAML',
  'bs4': 'beautifulsoup4',
  'telegram': 'python-telegram-bot',
  'telethon': 'Telethon',
  'pyrogram': 'Pyrogram',
  'aiogram': 'aiogram',
  'discord': 'discord.py',
  'OpenSSL': 'pyOpenSSL',
  'crypto': 'pycryptodome',
  'Crypto': 'pycryptodome',
  'matplotlib': 'matplotlib',
  'numpy': 'numpy',
  'pandas': 'pandas',
  'requests': 'requests',
  'aiohttp': 'aiohttp',
  'flask': 'Flask',
  'fastapi': 'fastapi',
  'uvicorn': 'uvicorn',
  'selenium': 'selenium',
  'lxml': 'lxml',
  'psutil': 'psutil',
  'dotenv': 'python-dotenv',
  'jwt': 'PyJWT',
  'oauthlib': 'OAuthLib',
  'pymongo': 'pymongo',
  'redis': 'redis',
  'celery': 'celery',
  'scrapy': 'Scrapy',
  'tweepy': 'tweepy',
  'instaloader': 'instaloader',
  'spotipy': 'spotipy',
  'yt_dlp': 'yt-dlp',
  'pydub': 'pydub',
  'openai': 'openai',
  'anthropic': 'anthropic',
  'google': 'google-generativeai',
  'openpyxl': 'openpyxl',
  'xlsxwriter': 'XlsxWriter',
  'xlrd': 'xlrd',
  'sqlalchemy': 'SQLAlchemy',
  'tornado': 'tornado',
  'websocket': 'websocket-client',
  'websockets': 'websockets',
  'grpc': 'grpcio',
  'protobuf': 'protobuf',
  'pymysql': 'PyMySQL',
  'psycopg2': 'psycopg2-binary',
  'asyncpg': 'asyncpg',
  'tldextract': 'tldextract',
  'ping3': 'ping3',
  'speedtest': 'speedtest-cli',
  'qrcode': 'qrcode[pil]',
  'pytz': 'pytz',
  'dateutil': 'python-dateutil',
  'apscheduler': 'APScheduler',
  'icalendar': 'icalendar',
  'pyowm': 'pyowm',
  'wikipedia': 'wikipedia',
  'newspaper3k': 'newspaper3k',
  'newspaper': 'newspaper3k',
  'feedparser': 'feedparser',
  'pyperclip': 'pyperclip',
  'pyautogui': 'PyAutoGUI',
  'pynput': 'pynput',
  'keyboard': 'keyboard',
  'mouse': 'mouse',
  'imageio': 'imageio',
  'moviepy': 'moviepy',
  'pytube': 'pytube',
  'instabot': 'instabot',
  'gtts': 'gTTS',
  'pydantic': 'pydantic',
  'orjson': 'orjson',
  'ujson': 'ujson',
  'httpx': 'httpx',
  'httpcore': 'httpcore',
  'trio': 'trio',
  'anyio': 'anyio',
  'cryptography': 'cryptography',
  'bcrypt': 'bcrypt',
  'paramiko': 'paramiko',
  'fabric': 'fabric',
  'snmp': 'pysnmp',
  'pysnmp': 'pysnmp',
  'netmiko': 'netmiko',
  'napalm': 'napalm',
  'scapy': 'scapy',
  'dpkt': 'dpkt',
  'pcap': 'pypcap',
};

function scanPythonImports(dir) {
  const found = new Set();
  const files = [];

  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '__pycache__') continue;
        walk(full);
      } else if (entry.name.endsWith('.py')) {
        files.push(full);
      }
    }
  }

  walk(dir);

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const importRe = /^\s*import\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/gm;
    let m;
    while ((m = importRe.exec(content)) !== null) {
      const top = m[1].split('.')[0];
      found.add(top);
    }
    const fromRe = /^\s*from\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s+import/gm;
    while ((m = fromRe.exec(content)) !== null) {
      const top = m[1].split('.')[0];
      found.add(top);
    }
  }

  const external = [];
  for (const mod of found) {
    if (STDLIB_MODULES.has(mod)) continue;
    const pipName = PIP_NAME_MAP[mod] || mod;
    external.push(pipName);
  }

  return [...new Set(external)];
}

function autoInstallPythonDeps(dir, pythonBin, pipMode, onLog) {
  const deps = scanPythonImports(dir);
  if (deps.length === 0) {
    return { success: true, installed: [] };
  }

  onLog(`📦 اكتشفت تلقائياً ${deps.length} مكتبة بايثون: ${deps.join(', ')}\n`, 'stdout');

  let args;
  if (pipMode === 'module') {
    args = ['-m', 'pip', 'install', ...deps, '--break-system-packages', '--quiet'];
  } else {
    args = ['install', ...deps, '--break-system-packages', '--quiet'];
  }

  const r = spawnSync(pipMode === 'module' ? pythonBin : 'pip3', args, {
    cwd: dir,
    stdio: 'pipe',
    shell: true,
    timeout: 180000,
  });

  const stdout = r.stdout ? r.stdout.toString() : '';
  const stderr = r.stderr ? r.stderr.toString() : '';

  if (stdout) onLog(stdout, 'stdout');
  if (stderr) onLog(stderr, 'stderr');

  if (r.status !== 0) {
    return { success: false, installed: deps, error: `فشل تثبيت بعض المكتبات (كود ${r.status})` };
  }

  onLog(`✅ تم تثبيت ${deps.length} مكتبة بنجاح.\n`, 'stdout');
  return { success: true, installed: deps };
}

module.exports = { scanPythonImports, autoInstallPythonDeps, STDLIB_MODULES, PIP_NAME_MAP };
