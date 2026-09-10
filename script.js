// ===== FPS 反应速度测试 - 射击训练 =====
// 纯前端实现，无任何后端依赖，可直接部署到 GitHub Pages。

/* ===== 全局配置 ===== */
const DIFFICULTY_CONFIG = {
  easy:   { targetSize: 60, targetCount: 4, lifespan: 1500 },
  medium: { targetSize: 45, targetCount: 5, lifespan: 1000 },
  hard:   { targetSize: 32, targetCount: 6, lifespan: 700 }
};

const MODE_CONFIG = {
  classic:   { scorePerHit: 100, movingTargets: false, speed: 0 },
  precision: { scorePerHit: 150, movingTargets: true, speed: 1.5 },
  hardcore:  { scorePerHit: 200, movingTargets: true, speed: 3.0 }
};

// 干扰项配置：纯色红色圆，点击扣分
const DECOY_CONFIG = {
  count: 2,         // 同屏干扰项数量
  size: 44,         // 干扰项直径
  penalty: 50       // 点击扣分
};

/* ===== 文案映射 ===== */
const MODE_LABEL = {
  classic: '经典',
  precision: '精准',
  hardcore: '硬核'
};

const DIFFICULTY_LABEL = {
  easy: '简单',
  medium: '中等',
  hard: '困难'
};


const GAME_STATE = {
  NOT_STARTED: 'not-started',
  RUNNING: 'running',
  ENDED: 'ended'
};

/* ===== 工具函数 ===== */
// 目标之间的最小间隙，保证视觉上不粘连
const TARGET_SPACING = 8;
// 生成目标时的最大尝试次数，防止极端情况下死循环
const SPAWN_MAX_ATTEMPTS = 200;

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

// 判断两个圆形目标是否重叠（含最小间隙）
function isOverlapping(a, b, spacing = TARGET_SPACING) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const minDistance = (a.size + b.size) / 2 + spacing;
  return dx * dx + dy * dy < minDistance * minDistance;
}

function formatDate(timestamp) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ===== 游戏类 ===== */
class AimTrainer {
  constructor() {
    this.arena = document.getElementById('arena');
    this.startScreen = document.getElementById('startScreen');
    this.startBtn = document.getElementById('startBtn');
    this.scoreEl = document.getElementById('score');
    this.accuracyEl = document.getElementById('accuracy');
    this.timeLeftEl = document.getElementById('timeLeft');
    this.streakEl = document.getElementById('streak');
    this.decoyHitsEl = document.getElementById('decoyHits');
    this.modeSelect = document.getElementById('modeSelect');
    this.difficultyGroup = document.getElementById('difficultySelect');
    this.durationGroup = document.getElementById('durationSelect');
    this.scoreTableBody = document.getElementById('scoreTableBody');
    this.clearScoresBtn = document.getElementById('clearScoresBtn');
    this.stats = {
      totalRounds: document.getElementById('totalRounds'),
      totalHits: document.getElementById('totalHits'),
      totalShots: document.getElementById('totalShots'),
      overallAccuracy: document.getElementById('overallAccuracy'),
      bestStreak: document.getElementById('bestStreakStat'),
      bestReaction: document.getElementById('bestReaction'),
      highestScore: document.getElementById('highestScore'),
      lastPlayed: document.getElementById('lastPlayed')
    };

    this.state = GAME_STATE.NOT_STARTED;
    this.targets = [];
    this.raf = null;
    this.selected = {
      mode: 'classic',
      difficulty: 'easy',
      duration: 15
    };
    // 初始化事件绑定与本地设置，否则按钮不会有响应
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadSettings();
    this.renderLeaderboard();
    this.renderStats();
    this.updateTimeLeft(0);
  }

  bindEvents() {
    // 开始按钮点击不能冒泡到 arena，否则会被误判为一次 miss
    this.startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.startGame();
    });

    this.difficultyGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      this.selected.difficulty = btn.dataset.value;
      this.updateActiveButtons(this.difficultyGroup, btn);
    });

    this.durationGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      this.selected.duration = parseInt(btn.dataset.value, 10);
      this.updateActiveButtons(this.durationGroup, btn);
    });

    this.arena.addEventListener('click', (e) => {
      if (this.state === GAME_STATE.RUNNING) this.handleClick(e);
    });

    window.addEventListener('resize', () => {
      if (this.state === GAME_STATE.RUNNING) {
        this.clampAllTargets();
      }
    });

    this.clearScoresBtn.addEventListener('click', () => this.clearHistory());
  }

  loadSettings() {
    const saved = localStorage.getItem('aimTrainerSettings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.selected = { ...this.selected, ...parsed };
      } catch (e) {
        console.warn('读取设置失败，使用默认值', e);
      }
    }
    this.modeSelect.value = this.selected.mode;
    this.syncSegmentedButtons();
  }

  syncSegmentedButtons() {
    [this.difficultyGroup, this.durationGroup].forEach(group => {
      group.querySelectorAll('.seg-btn').forEach(btn => {
        let isActive = false;
        if (group === this.difficultyGroup) {
          isActive = btn.dataset.value === this.selected.difficulty;
        } else if (group === this.durationGroup) {
          isActive = parseInt(btn.dataset.value, 10) === this.selected.duration;
        }
        btn.classList.toggle('active', isActive);
      });
    });
  }

  updateActiveButtons(group, activeBtn) {
    group.querySelectorAll('.seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn === activeBtn);
    });
    this.saveSettings();
  }

  startGame() {
    if (this.state === GAME_STATE.RUNNING) return;

    this.selected.mode = this.modeSelect.value;
    this.saveSettings();

    this.targets = [];
    this.score = 0;
    this.hits = 0;
    this.misses = 0;
    this.decoyHits = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.reactionTimes = [];

    this.arena.querySelectorAll('.target').forEach(t => t.remove());
    this.startScreen.style.display = 'none';

    this.updateScore();
    this.updateAccuracy();
    this.updateStreak();
    this.updateDecoyHits();
    this.updateTimeLeft(this.selected.duration);

    this.state = GAME_STATE.RUNNING;
    this.startTime = performance.now();
    this.endTime = this.startTime + this.selected.duration * 1000;
    this.lastShotTime = this.startTime;

    this.spawnInitialTargets();
    this.raf = requestAnimationFrame(this.gameLoop.bind(this));
  }

  saveSettings() {
    localStorage.setItem('aimTrainerSettings', JSON.stringify(this.selected));
  }

  loadHistory() {
    try {
      const saved = localStorage.getItem('aimTrainerHistory');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('读取历史成绩失败', e);
      return [];
    }
  }

  saveHistory(history) {
    localStorage.setItem('aimTrainerHistory', JSON.stringify(history));
  }

  clearHistory() {
    if (!confirm('确定要清空所有训练记录吗？此操作不可恢复。')) return;
    localStorage.removeItem('aimTrainerHistory');
    this.renderLeaderboard();
    this.renderStats();
  }

  saveCurrentResult() {
    const total = this.hits + this.misses;
    const accuracy = total > 0 ? Math.round((this.hits / total) * 100) : 0;
    const avgReaction = this.reactionTimes.length > 0
      ? Math.round(this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length)
      : 0;

    const record = {
      score: this.score,
      hits: this.hits,
      misses: this.misses,
      accuracy,
      bestStreak: this.bestStreak,
      avgReaction,
      mode: this.selected.mode,
      difficulty: this.selected.difficulty,
      duration: this.selected.duration,
      playedAt: Date.now()
    };

    const history = this.loadHistory();
    history.push(record);
    // 只保留最近 100 条记录，避免 localStorage 无限增长
    history.sort((a, b) => b.score - a.score || b.playedAt - a.playedAt);
    this.saveHistory(history.slice(0, 100));
    this.renderLeaderboard();
    this.renderStats();
  }

  renderLeaderboard() {
    const history = this.loadHistory();

    if (history.length === 0) {
      this.scoreTableBody.innerHTML = '<tr class="empty-row"><td colspan="7">暂无训练记录，完成一局后自动保存。</td></tr>';
      return;
    }

    this.scoreTableBody.innerHTML = history.map((record, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${record.score}</strong></td>
        <td>${record.accuracy}%</td>
        <td>${MODE_LABEL[record.mode] || record.mode}</td>
        <td>${DIFFICULTY_LABEL[record.difficulty] || record.difficulty}</td>
        <td>${record.duration}s</td>
        <td>${formatDate(record.playedAt)}</td>
      </tr>
    `).join('');
  }

  renderStats() {
    const history = this.loadHistory();

    if (history.length === 0) {
      this.stats.totalRounds.textContent = '0';
      this.stats.totalHits.textContent = '0';
      this.stats.totalShots.textContent = '0';
      this.stats.overallAccuracy.textContent = '0%';
      this.stats.bestStreak.textContent = '0';
      this.stats.bestReaction.textContent = '--';
      this.stats.highestScore.textContent = '0';
      this.stats.lastPlayed.textContent = '--';
      return;
    }

    const totalHits = history.reduce((sum, r) => sum + r.hits, 0);
    const totalShots = history.reduce((sum, r) => sum + r.hits + r.misses, 0);
    const overallAccuracy = totalShots > 0 ? Math.round((totalHits / totalShots) * 100) : 0;
    const bestReaction = Math.min(...history.filter(r => r.avgReaction > 0).map(r => r.avgReaction));
    const lastPlayed = Math.max(...history.map(r => r.playedAt));

    this.stats.totalRounds.textContent = history.length;
    this.stats.totalHits.textContent = totalHits;
    this.stats.totalShots.textContent = totalShots;
    this.stats.overallAccuracy.textContent = `${overallAccuracy}%`;
    this.stats.bestStreak.textContent = Math.max(...history.map(r => r.bestStreak));
    this.stats.bestReaction.textContent = Number.isFinite(bestReaction) ? `${bestReaction}ms` : '--';
    this.stats.highestScore.textContent = Math.max(...history.map(r => r.score));
    this.stats.lastPlayed.textContent = formatDate(lastPlayed);
  }

  spawnInitialTargets() {
    const config = DIFFICULTY_CONFIG[this.selected.difficulty];
    for (let i = 0; i < config.targetCount; i++) {
      this.spawnTarget();
    }
    for (let i = 0; i < DECOY_CONFIG.count; i++) {
      this.spawnTarget(true);
    }
  }

  spawnTarget(isDecoy = false) {
    const config = DIFFICULTY_CONFIG[this.selected.difficulty];
    const modeConfig = MODE_CONFIG[this.selected.mode];
    const arenaRect = this.arena.getBoundingClientRect();
    const size = isDecoy ? DECOY_CONFIG.size : config.targetSize;

    // 位置表示目标圆心；配合 CSS 的 translate(-50%, -50%) 居中渲染
    const halfSize = size / 2;
    let x = 0;
    let y = 0;
    let isPositionValid = false;

    // 多次尝试寻找一个既不越界、也不与其他目标重叠的位置
    for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
      x = randomRange(halfSize, arenaRect.width - halfSize);
      y = randomRange(halfSize, arenaRect.height - halfSize);

      const candidate = { x, y, size };
      if (!this.targets.some(existing => isOverlapping(candidate, existing))) {
        isPositionValid = true;
        break;
      }
    }

    // 极端情况下找不到完全分离的位置时，选取距离所有目标最远的一点，
    // 并在下一帧继续由碰撞逻辑修正，避免卡死或完全重叠。
    if (!isPositionValid && this.targets.length > 0) {
      let bestDistance = -1;
      for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
        const candidateX = randomRange(halfSize, arenaRect.width - halfSize);
        const candidateY = randomRange(halfSize, arenaRect.height - halfSize);
        const nearestDistance = this.targets.reduce((minDistance, existing) => {
          const distance = Math.hypot(candidateX - existing.x, candidateY - existing.y);
          return Math.min(minDistance, distance);
        }, Number.POSITIVE_INFINITY);

        if (nearestDistance > bestDistance) {
          bestDistance = nearestDistance;
          x = candidateX;
          y = candidateY;
        }
      }
    }

    const target = document.createElement('div');
    target.className = 'target';
    if (isDecoy) target.classList.add('decoy');
    target.style.width = `${size}px`;
    target.style.height = `${size}px`;
    target.style.left = `${x}px`;
    target.style.top = `${y}px`;

    const angle = Math.random() * Math.PI * 2;
    const vx = modeConfig.movingTargets ? Math.cos(angle) * modeConfig.speed : 0;
    const vy = modeConfig.movingTargets ? Math.sin(angle) * modeConfig.speed : 0;

    this.arena.appendChild(target);
    this.targets.push({
      element: target,
      x,
      y,
      vx,
      vy,
      size,
      isDecoy,
      spawnTime: performance.now()
    });
  }

  gameLoop(now) {
    if (this.state !== GAME_STATE.RUNNING) return;

    const remaining = Math.max(0, (this.endTime - now) / 1000);
    this.updateTimeLeft(remaining);

    if (now >= this.endTime) {
      this.endGame();
      return;
    }

    const arenaRect = this.arena.getBoundingClientRect();
    this.targets.forEach(targetObj => {
      targetObj.x += targetObj.vx;
      targetObj.y += targetObj.vy;

      // 边界反弹，并同步取反速度，防止目标卡在边界外
      const halfSize = targetObj.size / 2;
      if (targetObj.x - halfSize <= 0) {
        targetObj.x = halfSize;
        targetObj.vx = Math.abs(targetObj.vx);
      } else if (targetObj.x + halfSize >= arenaRect.width) {
        targetObj.x = arenaRect.width - halfSize;
        targetObj.vx = -Math.abs(targetObj.vx);
      }

      if (targetObj.y - halfSize <= 0) {
        targetObj.y = halfSize;
        targetObj.vy = Math.abs(targetObj.vy);
      } else if (targetObj.y + halfSize >= arenaRect.height) {
        targetObj.y = arenaRect.height - halfSize;
        targetObj.vy = -Math.abs(targetObj.vy);
      }

      targetObj.element.style.left = `${targetObj.x}px`;
      targetObj.element.style.top = `${targetObj.y}px`;
    });

    // 目标间的弹性碰撞：避免移动目标长时间重叠或粘连
    for (let i = 0; i < this.targets.length; i++) {
      for (let j = i + 1; j < this.targets.length; j++) {
        const a = this.targets[i];
        const b = this.targets[j];
        if (!isOverlapping(a, b)) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        const minDistance = (a.size + b.size) / 2 + TARGET_SPACING;

        // 两个中心完全重合时，使用固定方向分离，避免除以 0
        const safeDx = distance === 0 ? 1 : dx / distance;
        const safeDy = distance === 0 ? 0 : dy / distance;
        const separation = (minDistance - distance) / 2;

        // 位置分离
        a.x -= safeDx * separation;
        a.y -= safeDy * separation;
        b.x += safeDx * separation;
        b.y += safeDy * separation;

        // 速度沿碰撞法线交换，模拟同质量弹性碰撞
        const relativeVelocity = (b.vx - a.vx) * safeDx + (b.vy - a.vy) * safeDy;
        if (relativeVelocity < 0) {
          a.vx += safeDx * relativeVelocity;
          a.vy += safeDy * relativeVelocity;
          b.vx -= safeDx * relativeVelocity;
          b.vy -= safeDy * relativeVelocity;
        }

        // 分离后重新 clamp 到边界内
        this.clampTarget(a, arenaRect);
        this.clampTarget(b, arenaRect);
      }
    }

    this.raf = requestAnimationFrame(this.gameLoop.bind(this));
  }

  handleClick(event) {
    if (this.state !== GAME_STATE.RUNNING) return;

    const target = event.target.closest('.target');
    const now = performance.now();

    // 干扰项：扣分、视为未命中、清空连击，但不刷新新目标
    if (target && target.classList.contains('decoy')) {
      this.decoyHits++;
      this.misses++;
      this.streak = 0;
      this.score = Math.max(0, this.score - DECOY_CONFIG.penalty);

      this.removeTarget(target);
      this.spawnTarget(true);
      this.updateDecoyHits();
      this.lastShotTime = now;
      this.updateScore();
      this.updateAccuracy();
      this.updateStreak();
      return;
    }

    if (target) {
      this.hits++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.score += MODE_CONFIG[this.selected.mode].scorePerHit + this.streak * 10;

      if (this.lastShotTime > 0) {
        this.reactionTimes.push(now - this.lastShotTime);
      }

      this.removeTarget(target);
      this.spawnTarget();
    } else {
      this.misses++;
      this.streak = 0;
    }

    this.lastShotTime = now;
    this.updateScore();
    this.updateAccuracy();
    this.updateStreak();
  }

  removeTarget(targetElement) {
    this.targets = this.targets.filter(t => t.element !== targetElement);
    targetElement.remove();
  }

  // 将单个目标限制在测试区域内部，保证圆边不越界
  clampTarget(targetObj, rect) {
    const halfSize = targetObj.size / 2;
    targetObj.x = Math.max(halfSize, Math.min(rect.width - halfSize, targetObj.x));
    targetObj.y = Math.max(halfSize, Math.min(rect.height - halfSize, targetObj.y));
    targetObj.element.style.left = `${targetObj.x}px`;
    targetObj.element.style.top = `${targetObj.y}px`;
  }

  clampAllTargets() {
    const rect = this.arena.getBoundingClientRect();
    this.targets.forEach(targetObj => {
      this.clampTarget(targetObj, rect);
    });
  }

  updateScore() {
    this.scoreEl.textContent = this.score || 0;
  }

  updateAccuracy() {
    const total = this.hits + this.misses;
    const accuracy = total > 0 ? Math.round((this.hits / total) * 100) : 0;
    this.accuracyEl.textContent = `${accuracy}%`;
  }

  updateStreak() {
    this.streakEl.textContent = this.streak || 0;
  }

  updateDecoyHits() {
    this.decoyHitsEl.textContent = this.decoyHits || 0;
  }

  updateTimeLeft(seconds) {
    this.timeLeftEl.textContent = formatTime(seconds);
  }

  endGame() {
    if (this.state === GAME_STATE.ENDED) return;
    this.state = GAME_STATE.ENDED;
    cancelAnimationFrame(this.raf);
    this.arena.querySelectorAll('.target').forEach(t => t.remove());
    this.targets = [];
    this.saveCurrentResult();
    this.showResults();
  }

  showResults() {
    const total = this.hits + this.misses;
    const accuracy = total > 0 ? Math.round((this.hits / total) * 100) : 0;
    const avgReaction = this.reactionTimes.length > 0
      ? Math.round(this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length)
      : 0;

    const resultScreen = document.createElement('div');
    resultScreen.className = 'start-screen result-screen';
    resultScreen.innerHTML = `
      <h2>训练完成</h2>
      <p>你已完成本轮训练，以下是你的成绩单。</p>
      <div class="results-grid">
        <div class="result-item"><span>得分</span><strong>${this.score}</strong></div>
        <div class="result-item"><span>命中数</span><strong>${this.hits}</strong></div>
        <div class="result-item"><span>命中率</span><strong>${accuracy}%</strong></div>
        <div class="result-item"><span>干扰命中</span><strong>${this.decoyHits}</strong></div>
        <div class="result-item"><span>最高连击</span><strong>${this.bestStreak}</strong></div>
        <div class="result-item"><span>平均反应</span><strong>${avgReaction}ms</strong></div>
      </div>
      <button class="start-btn" id="restartBtn">再来一局</button>
    `;

    this.arena.appendChild(resultScreen);

    const restartBtn = resultScreen.querySelector('#restartBtn');
    restartBtn.addEventListener('click', () => {
      resultScreen.remove();
      this.state = GAME_STATE.NOT_STARTED;
      this.startScreen.style.display = 'flex';
      this.updateTimeLeft(0);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new AimTrainer();
});
