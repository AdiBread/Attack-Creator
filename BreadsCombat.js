/*:
 * @plugindesc Undertale Combat Engine v30 - Audio Configuration Hotfix
 * @author AI Collaborator
 *
 * @param DefaultKeyCount
 * @text QTE Arrow Sequence Count
 * @type number
 * @default 4
 *
 * @param HurtSoundName
 * @text Hurt Sound Effect (SE)
 * @desc The filename of the sound effect inside audio/se/ played when taking damage. Do not include extension.
 * @type file
 * @dir audio/se/
 * @default Damage1
 *
 * @help
 * Implements an advanced sequential execution track for alternating player QTEs, 
 * dialogue blocks, and bullet-evasion fields.
 *
 * Enemy Note Tags:
 * <DMG: 25>     <- MUST BE ON THE FIRST LINE OF THE ENEMY NOTES. Overrides default damage.
 * <DIALOGUE: "text">
 * <ENGAGE: "file.json">
 * <CONTROL>
 */

var combat = combat || {};

// Hardened fallback parameter parsing targeting BreadsCombat explicitly
var $pluginsData = PluginManager.parameters('BreadsCombat');
if (!$pluginsData || Object.keys($pluginsData).length === 0) {
    $pluginsData = PluginManager.parameters('DK_UndertaleCombat') || {};
}

combat.keyCount = Number($pluginsData['DefaultKeyCount'] || 4);

// Safely sanitize the sound parameter by stripping off accidental extensions (.ogg, .m4a)
var soundName = String($pluginsData['HurtSoundName'] || "Damage1").trim();
combat.hurtSoundParam = soundName.replace(/\.(ogg|m4a|rpgmvo)$/i, "");

combat.resetStates = function() {
    combat.qteActive = false;
    combat.evasionActive = false;
    combat.damageMod = undefined;
    combat.iFrames = 0;
    combat.justAttacked = false; 
    combat.scriptedQueueActive = false;
    combat.enemyDamageOverride = undefined;
};
combat.resetStates();

//-----------------------------------------------------------------------------
// Window_QTEBox (Arrow Prompt Execution Engine)
//-----------------------------------------------------------------------------
function Window_QTEBox() { this.initialize.apply(this, arguments); }
Window_QTEBox.prototype = Object.create(Window_Base.prototype);
Window_QTEBox.prototype.constructor = Window_QTEBox;

Window_QTEBox.prototype.initialize = function() {
    var w = 360;
    var h = 90;
    var x = (Graphics.boxWidth - w) / 2;
    var y = Graphics.boxHeight - h - 140;
    
    if (typeof this.findCustomFont !== 'function') {
        Window_QTEBox.prototype.findCustomFont = function() { return null; };
    }
    
    Window_Base.prototype.initialize.call(this, x, y, w, h);
    this.openness = 0;
    this.deactivate();
};

Window_QTEBox.prototype.startQTE = function(callback) {
    if ($gameParty.isAllDead()) {
        SceneManager.goto(Scene_Gameover);
        return;
    }
    combat.qteActive = true;
    this._callback = callback;
    this._currentIndex = 0;
    this._generatedKeys = [];
    
    var pool = ['left', 'up', 'right', 'down'];
    for (var i = 0; i < combat.keyCount; i++) {
        this._generatedKeys.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    this.open();
    this.activate();
    this.refresh();
};

Window_QTEBox.prototype.refresh = function() {
    this.contents.clear();
    this.changeTextColor(this.systemColor());
    this.drawText("FIGHT:", 10, 4, 70, 'left');
    
    for (var i = 0; i < this._generatedKeys.length; i++) {
        if (i < this._currentIndex) this.changeTextColor(this.textColor(3)); 
        else if (i === this._currentIndex) this.changeTextColor(this.textColor(0)); 
        else this.changeTextColor(this.textColor(7)); 
        
        var sym = "←";
        if (this._generatedKeys[i] === 'up') sym = "↑";
        if (this._generatedKeys[i] === 'right') sym = "→";
        if (this._generatedKeys[i] === 'down') sym = "↓";
        
        this.drawText(sym, 90 + (i * 45), 4, 40, 'center');
    }
};

Window_QTEBox.prototype.update = function() {
    Window_Base.prototype.update.call(this);
    if ($gameParty.isAllDead()) {
        combat.resetStates();
        SceneManager.goto(Scene_Gameover);
        return;
    }
    if (!this.active) return;
    
    var target = this._generatedKeys[this._currentIndex];
    if (Input.isTriggered(target)) {
        this._currentIndex++;
        this.refresh();
        if (this._currentIndex >= this._generatedKeys.length) {
            this.complete(true);
        }
    } else {
        var arrows = ['left', 'up', 'right', 'down'];
        for (var i = 0; i < arrows.length; i++) {
            if (arrows[i] !== target && Input.isTriggered(arrows[i])) {
                this.complete(false);
                break;
            }
        }
    }
};

Window_QTEBox.prototype.complete = function(success) {
    this.deactivate();
    this.close();
    combat.qteActive = false;
    if (this._callback) this._callback(success);
};

//-----------------------------------------------------------------------------
// Core Action Interceptors & Menu Crash Protectors
//-----------------------------------------------------------------------------
var _Scene_Battle_commandAttack = Scene_Battle.prototype.commandAttack;
Scene_Battle.prototype.commandAttack = function() {
    var action = BattleManager.inputtingAction();
    if (!action) {
        var actor = BattleManager.actor();
        if (actor) actor.selectNextCommand();
    }
    _Scene_Battle_commandAttack.call(this);
};

var _BattleManager_invokeNormalAction = BattleManager.invokeNormalAction;
BattleManager.invokeNormalAction = function(subject, target) {
    var isAttackAction = this._action && (this._action.isAttack() || (this._action.item() && this._action.item().id === subject.attackSkillId()));
    if (subject.isActor() && isAttackAction && SceneManager._scene instanceof Scene_Battle && !combat.evasionActive) {
        BattleManager._phase = 'actionWait';
        SceneManager._scene._qteWindow.startQTE(function(success) {
            combat.damageMod = success ? 1.5 : 0.2;
            combat.justAttacked = true; 
            _BattleManager_invokeNormalAction.call(BattleManager, subject, target);
            BattleManager._phase = 'action';
        });
        return;
    }
    _BattleManager_invokeNormalAction.call(this, subject, target);
};

var _Game_Action_makeDamageValue = Game_Action.prototype.makeDamageValue;
Game_Action.prototype.makeDamageValue = function(target, critical) {
    var val = _Game_Action_makeDamageValue.call(this, target, critical);
    if ((this.isAttack() || (this.item() && this.item().id === this.subject().attackSkillId())) && this.subject().isActor() && combat.damageMod !== undefined) {
        val = Math.round(val * combat.damageMod);
        combat.damageMod = undefined;
    }
    return val;
};

//-----------------------------------------------------------------------------
// Window_UndertaleArena (Evasion Gameplay Viewport Core)
//-----------------------------------------------------------------------------
function Window_UndertaleArena() { this.initialize.apply(this, arguments); }
Window_UndertaleArena.prototype = Object.create(Window_Base.prototype);
Window_UndertaleArena.prototype.constructor = Window_UndertaleArena;

Window_UndertaleArena.prototype.initialize = function() {
    var w = 308;
    var h = 208;
    var x = (Graphics.boxWidth - w) / 2;
    var y = (Graphics.boxHeight - h) / 2 + 20;
    
    if (typeof this.findCustomFont !== 'function') {
        Window_UndertaleArena.prototype.findCustomFont = function() { return null; };
    }
    
    Window_Base.prototype.initialize.call(this, x, y, w, h);
    this.openness = 0;
    this._liveBullets = [];
    this._undertalePhase = 'idle';
    this.createSoulSprite();
};

Window_UndertaleArena.prototype.createSoulSprite = function() {
    this._soul = new Sprite();
    this._soul.bitmap = new Bitmap(16, 16);
    this._soul.bitmap.fillAll('#FF0000'); // Clean native rendering fallback
    this.addChild(this._soul);
    this.centerSoul();
};

Window_UndertaleArena.prototype.centerSoul = function() {
    this._soul.x = (this.width - 16) / 2;
    this._soul.y = (this.height - 16) / 2;
};

Window_UndertaleArena.prototype.setEvasionPhase = function(payload) {
    if ($gameParty.isAllDead()) {
        combat.resetStates();
        SceneManager.goto(Scene_Gameover);
        return;
    }
    this._timeline = payload.timeline || [];
    for (var i = 0; i < this._timeline.length; i++) {
        this._timeline[i].spawned = false;
    }
    
    this.centerSoul();
    if (payload.startSoul) {
        this._soul.x = (payload.startSoul.x || 142).clamp(12, this.width - 28);
        this._soul.y = (payload.startSoul.y || 92).clamp(12, this.height - 28);
    }
    
    this._evasionDurationFrames = Math.round(((payload.duration || 5000) / 1000) * 60);
    this._startFrameCount = Graphics.frameCount;
    this._undertalePhase = 'active';
    combat.evasionActive = true;
    combat.iFrames = 0;
    this.open();
};

Window_UndertaleArena.prototype.update = function() {
    Window_Base.prototype.update.call(this);
    if ($gameParty.isAllDead()) {
        this.forceStopEvasion();
        combat.resetStates();
        SceneManager.goto(Scene_Gameover);
        return;
    }

    if (combat.iFrames > 0) {
        combat.iFrames--;
        this._soul.visible = Math.floor(combat.iFrames / 4) % 2 === 0;
    } else {
        this._soul.visible = true;
    }

    if (this._undertalePhase === 'active') {
        this.processSoulMovement();
        this.processBulletsEngine();
    }
};

Window_UndertaleArena.prototype.processSoulMovement = function() {
    var step = 4;
    this._isMoving = false;
    
    if (Input.isPressed('left'))  { this._soul.x -= step; this._isMoving = true; }
    if (Input.isPressed('right')) { this._soul.x += step; this._isMoving = true; }
    if (Input.isPressed('up'))    { this._soul.y -= step; this._isMoving = true; }
    if (Input.isPressed('down'))  { this._soul.y += step; this._isMoving = true; }

    var minX = 12;
    var maxX = this.width - 28;
    var minY = 12;
    var maxY = this.height - 28;

    this._soul.x = this._soul.x.clamp(minX, maxX);
    this._soul.y = this._soul.y.clamp(minY, maxY);
};

Window_UndertaleArena.prototype.processBulletsEngine = function() {
    var currentElapsedFrames = Graphics.frameCount - this._startFrameCount;

    if (currentElapsedFrames >= this._evasionDurationFrames) {
        this.clearEvasionField();
        return;
    }

    var currentElapsedMs = (currentElapsedFrames / 60) * 1000;

    for (var i = 0; i < this._timeline.length; i++) {
        var node = this._timeline[i];
        if (node && !node.spawned && currentElapsedMs >= node.time) {
            node.spawned = true;
            this.generateBullet(node, currentElapsedFrames);
        }
    }

    for (var j = this._liveBullets.length - 1; j >= 0; j--) {
        var b = this._liveBullets[j];
        var ageFrames = currentElapsedFrames - b.bornFrame;
        var ageMs = (ageFrames / 60) * 1000;

        if (b.movement === 'custom' && b.keyframes && b.keyframes.length > 0) {
            var totalSteps = b.keyframes.length - 1;
            var pathDuration = totalSteps * 100; 
            var progress = (ageMs / pathDuration).clamp(0, 1);
            
            if (b.easing === 'smooth') {
                progress = progress * progress * (3 - 2 * progress);
            }
            
            var exactIndex = progress * totalSteps;
            var baseIdx = Math.floor(exactIndex);
            var nextIdx = Math.ceil(exactIndex);
            var ratio = exactIndex - baseIdx;

            var p1 = b.keyframes[baseIdx];
            var p2 = b.keyframes[nextIdx];

            if (p1 && p2) {
                b.sprite.x = p1.x + (p2.x - p1.x) * ratio;
                b.sprite.y = p1.y + (p2.y - p1.y) * ratio;
            }
        } else {
            if (b.movement === 'rightLeft' || b.movement === 'Straight Left-to-Right Horizontal') b.sprite.x -= b.speed;
            else if (b.movement === 'topDown') b.sprite.y += b.speed;
            else if (b.movement === 'bottomUp') b.sprite.y -= b.speed;
            else if (b.movement === 'sine') {
                b.sprite.x += b.speed;
                b.sprite.y = b.originY + Math.sin(ageMs * 0.006) * 40;
            } else b.sprite.x += b.speed; 
        }

        if (this.hitTest(this._soul, b)) {
            var targetActor = $gameParty.battleMembers()[0];
            var mainEnemy = $gameTroop.members()[0];

            if (targetActor && !targetActor.isDead()) {
                var takeDamage = false;

                if (b.type === 'blue' || b.type === 'Blue Damage') {
                    if (this._isMoving) takeDamage = true;
                } else if (b.type === 'orange' || b.type === 'Orange Damage') {
                    if (!this._isMoving) takeDamage = true;
                } else if (b.type === 'green' || b.type === 'Green Healing') {
                    targetActor.gainHp(Math.round(b.damage * 1.5));
                    targetActor.startDamagePopup();
                    if (SceneManager._scene instanceof Scene_Battle) {
                        SceneManager._scene._statusWindow.refresh();
                    }
                } else {
                    takeDamage = true;
                }

                if (takeDamage && combat.iFrames === 0) {
                    if (combat.hurtSoundParam) {
                        AudioManager.playSe({ name: combat.hurtSoundParam, volume: 90, pitch: 100, pan: 0 });
                    }

                    var baseDamageValue = (combat.enemyDamageOverride !== undefined) ? combat.enemyDamageOverride : b.damage;
                    var enemyAtk = mainEnemy ? mainEnemy.atk : 20;
                    var trueCalculatedDamage = Math.max(5, (enemyAtk + baseDamageValue) - Math.floor(targetActor.def * 0.5));

                    targetActor._result.hpAffected = true;
                    targetActor._result.hpDamage = trueCalculatedDamage;
                    targetActor.gainHp(-trueCalculatedDamage);
                    targetActor.startDamagePopup();
                    
                    if (SceneManager._scene instanceof Scene_Battle) {
                        SceneManager._scene._statusWindow.refresh();
                    }
                    
                    combat.iFrames = 45; 

                    if (targetActor.isDead()) {
                        this.forceStopEvasion();
                        combat.resetStates();
                        SceneManager.goto(Scene_Gameover);
                        return;
                    }
                }
            }
            this.killBullet(j);
            continue;
        }

        if (b.sprite.x < -50 || b.sprite.x > this.width + 50 || b.sprite.y < -50 || b.sprite.y > this.height + 50) {
            this.killBullet(j);
        }
    }
};

Window_UndertaleArena.prototype.generateBullet = function(cfg, spawnFrame) {
    var size = cfg.hitbox || 16;
    var s = new Sprite();
    
    s.bitmap = new Bitmap(size, size);
    var color = '#FFFFFF';
    if (cfg.type === 'blue' || cfg.type === 'Blue Damage') color = '#0066FF';
    if (cfg.type === 'orange' || cfg.type === 'Orange Damage') color = '#FF9900';
    if (cfg.type === 'green' || cfg.type === 'Green Healing') color = '#00FF33';
    if (cfg.type === 'purple') color = '#CC33FF';
    if (cfg.type === 'spear') color = '#00FFFF';
    s.bitmap.fillAll(color);

    var typeMovement = cfg.movement;
    if (typeMovement === 'topDown') {
        s.x = cfg.customX || 100; s.y = -16;
    } else if (cfg.movement === 'bottomUp') {
        s.x = cfg.customX || 100; s.y = this.height;
    } else if (typeMovement === 'rightLeft' || typeMovement === 'Straight Left-to-Right Horizontal') {
        s.x = this.width; s.y = cfg.customY || 80;
    } else if (typeMovement === 'custom') {
        s.x = cfg.keyframes?.[0]?.x || 0; s.y = cfg.keyframes?.[0]?.y || 0;
    } else {
        s.x = -16; s.y = cfg.customY || 80;
    }

    this.addChild(s);
    this._liveBullets.push({
        sprite: s, speed: cfg.speed || 3, type: cfg.type, movement: typeMovement,
        keyframes: cfg.keyframes, easing: cfg.easing, bornFrame: spawnFrame,
        originY: s.y, damage: cfg.damage || 10, w: size, h: size
    });
};

Window_UndertaleArena.prototype.hitTest = function(soul, bullet) {
    var soulW = (this._soul.bitmap && this._soul.bitmap.width > 0) ? this._soul.bitmap.width : 16;
    var soulH = (this._soul.bitmap && this._soul.bitmap.height > 0) ? this._soul.bitmap.height : 16;
    return (soul.x < bullet.sprite.x + bullet.w && soul.x + soulW > bullet.sprite.x &&
            soul.y < bullet.sprite.y + bullet.h && soul.y + soulH > bullet.sprite.y);
};

Window_UndertaleArena.prototype.killBullet = function(idx) {
    if (this._liveBullets[idx] && this._liveBullets[idx].sprite) {
        this.removeChild(this._liveBullets[idx].sprite);
    }
    this._liveBullets.splice(idx, 1);
};

Window_UndertaleArena.prototype.forceStopEvasion = function() {
    this._undertalePhase = 'idle';
    this._soul.visible = true;
    for (var i = this._liveBullets.length - 1; i >= 0; i--) {
        this.killBullet(i);
    }
    this.close();
};

Window_UndertaleArena.prototype.clearEvasionField = function() {
    this.forceStopEvasion();
    if (SceneManager._scene instanceof Scene_Battle) {
        SceneManager._scene.executeNextQueueAction();
    }
};

//-----------------------------------------------------------------------------
// Hardened Interceptors: Full Window & Input Blockers
//-----------------------------------------------------------------------------
var _Window_Selectable_update = Window_Selectable.prototype.update;
Window_Selectable.prototype.update = function() {
    if (combat.qteActive || combat.evasionActive) return;
    _Window_Selectable_update.call(this);
};

var _Window_Selectable_isOpenAndActive = Window_Selectable.prototype.isOpenAndActive;
Window_Selectable.prototype.isOpenAndActive = function() {
    if (combat.qteActive || combat.evasionActive) return false;
    return _Window_Selectable_isOpenAndActive.call(this);
};

var _Scene_Battle_update = Scene_Battle.prototype.update;
Scene_Battle.prototype.update = function() {
    if ($gameParty.isAllDead()) {
        combat.resetStates();
        SceneManager.goto(Scene_Gameover);
        return;
    }

    if (combat.qteActive || combat.evasionActive) {
        if (this._utArenaWindow) this._utArenaWindow.update();
        if (this._qteWindow) this._qteWindow.update();
        
        if (this._actorCommandWindow && this._actorCommandWindow.active) {
            this._actorCommandWindow.deactivate();
            this._actorCommandWindow.close();
        }
        return;
    }
    _Scene_Battle_update.call(this);
};

//-----------------------------------------------------------------------------
// Hardened Turn-State Hand-offs on Action Completions
//-----------------------------------------------------------------------------
var _BattleManager_endAction = BattleManager.endAction;
BattleManager.endAction = function() {
    if ($gameParty.isAllDead()) {
        combat.resetStates();
        SceneManager.goto(Scene_Gameover);
        return;
    }
    _BattleManager_endAction.call(this);
    
    if (SceneManager._scene instanceof Scene_Battle && SceneManager._scene._actionQueue.length > 0) {
        if (combat.justAttacked) {
            combat.justAttacked = false;
            this._phase = 'turn';
            this._action = null;
            
            if ($gameParty.isAllDead()) {
                combat.resetStates();
                SceneManager.goto(Scene_Gameover);
                return;
            }
            if ($gameTroop.isAllDead()) {
                combat.resetStates();
                BattleManager.checkBattleEnd();
                return;
            }
            
            SceneManager._scene.executeNextQueueAction();
        }
    }
};

var _BattleManager_processTurn = BattleManager.processTurn;
BattleManager.processTurn = function() {
    if ($gameParty.isAllDead()) {
        combat.resetStates();
        SceneManager.goto(Scene_Gameover);
        return;
    }
    var subject = this._subject;
    if (subject && subject.isEnemy() && SceneManager._scene instanceof Scene_Battle && SceneManager._scene._actionQueue.length > 0) {
        subject.clearActions(); 
        this.endTurn();
        return;
    }
    _BattleManager_processTurn.call(this);
};

var _BattleManager_processVictory = BattleManager.processVictory;
BattleManager.processVictory = function() {
    combat.resetStates();
    if (SceneManager._scene instanceof Scene_Battle) {
        SceneManager._scene._actionQueue = [];
        SceneManager._scene._queueIdx = 0;
        SceneManager._scene._actionQueueParsed = false;
    }
    _BattleManager_processVictory.call(this);
};

//-----------------------------------------------------------------------------
// Scene Battle Lifecycle Extensions
//-----------------------------------------------------------------------------
var _Scene_Battle_initialize = Scene_Battle.prototype.initialize;
Scene_Battle.prototype.initialize = function() {
    _Scene_Battle_initialize.call(this);
    combat.resetStates();
    this._actionQueueParsed = false;
};

var _Scene_Battle_createAllWindows = Scene_Battle.prototype.createAllWindows;
Scene_Battle.prototype.createAllWindows = function() {
    _Scene_Battle_createAllWindows.call(this);
    this._qteWindow = new Window_QTEBox();
    this.addWindow(this._qteWindow);
    
    this._utArenaWindow = new Window_UndertaleArena();
    this.addWindow(this._utArenaWindow);
    
    this._actionQueue = [];
    this._queueIdx = 0;
};

var _Scene_Battle_start = Scene_Battle.prototype.start;
Scene_Battle.prototype.start = function() {
    _Scene_Battle_start.call(this);
    this.parseEnemyNoteData();
};

Scene_Battle.prototype.parseEnemyNoteData = function() {
    if (this._actionQueueParsed) return;
    var troop = $gameTroop.members();
    if (troop.length === 0) return;
    var notes = $dataEnemies[troop[0].enemyId()].note.split('\n');
    
    this._actionQueue = [];
    this._queueIdx = 0;
    combat.enemyDamageOverride = undefined;
    
    if (notes.length > 0 && notes[0].trim().match(/<DMG:\s*(\d+)>/i)) {
        combat.enemyDamageOverride = Number(RegExp.$1);
    }
    
    for (var i = 0; i < notes.length; i++) {
        var line = notes[i].trim();
        if (line.match(/<DIALOGUE:\s*"(.*)">/i)) {
            this._actionQueue.push({ type: 'text', data: RegExp.$1 });
        } else if (line.match(/<ENGAGE:\s*"(.*)">/i)) {
            this._actionQueue.push({ type: 'attack', data: RegExp.$1 });
        } else if (line.match(/<CONTROL>/i)) {
            this._actionQueue.push({ type: 'control' });
        }
    }
    this._actionQueueParsed = true;
    
    if (this._actionQueue.length > 0 && this._actionQueue[0].type === 'control') {
        this._queueIdx = 1;
    }
};

var _BattleManager_endTurn = BattleManager.endTurn;
BattleManager.endTurn = function() {
    if (SceneManager._scene instanceof Scene_Battle && SceneManager._scene._actionQueue.length > 0) {
        return; 
    }
    _BattleManager_endTurn.call(this);
};

//-----------------------------------------------------------------------------
// Note Tag Queue Executor Core (Strict Order Execution Engine)
//-----------------------------------------------------------------------------
Scene_Battle.prototype.executeNextQueueAction = function() {
    if ($gameParty.isAllDead()) {
        combat.resetStates();
        SceneManager.goto(Scene_Gameover);
        return;
    }
    if ($gameTroop.isAllDead()) {
        combat.resetStates();
        BattleManager.checkBattleEnd();
        return;
    }

    if (this._queueIdx >= this._actionQueue.length) {
        this._queueIdx = 0;
    }

    var item = this._actionQueue[this._queueIdx];
    this._queueIdx++;

    if (item.type === 'text') {
        this.runSpeechBubble(item.data);
    } else if (item.type === 'attack') {
        this.fetchAttackPayload(item.data);
    } else if (item.type === 'control') {
        combat.scriptedQueueActive = false;
        combat.evasionActive = false;
        combat.qteActive = false;
        combat.justAttacked = false;
        
        this._actorCommandWindow.deactivate();
        this._partyCommandWindow.deactivate();
        BattleManager.startInput(); 
    }
};

Scene_Battle.prototype.runSpeechBubble = function(msg) {
    if ($gameParty.isAllDead()) {
        combat.resetStates();
        SceneManager.goto(Scene_Gameover);
        return;
    }
    if ($gameTroop.isAllDead()) return;
    combat.evasionActive = true; 
    
    if (this._logWindow) {
        this._logWindow.clear();
        this._logWindow.addText(msg);
    }
    
    var self = this;
    setTimeout(function() {
        if ($gameParty.isAllDead()) {
            combat.resetStates();
            SceneManager.goto(Scene_Gameover);
            return;
        }
        if ($gameTroop.isAllDead()) return;
        if (self._logWindow) self._logWindow.clear();
        self.executeNextQueueAction();
    }, 2500);
};

Scene_Battle.prototype.fetchAttackPayload = function(file) {
    if ($gameParty.isAllDead()) {
        combat.resetStates();
        SceneManager.goto(Scene_Gameover);
        return;
    }
    if ($gameTroop.isAllDead()) return;
    var self = this;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'attacks/' + file);
    xhr.overrideMimeType('application/json');
    xhr.onload = function() {
        if (xhr.status < 400) {
            try {
                if ($gameParty.isAllDead()) {
                    combat.resetStates();
                    SceneManager.goto(Scene_Gameover);
                    return;
                }
                if ($gameTroop.isAllDead()) return;
                self._utArenaWindow.setEvasionPhase(JSON.parse(xhr.responseText));
            } catch (e) {
                self.executeNextQueueAction();
            }
        } else {
            self.executeNextQueueAction();
        }
    };
    xhr.onerror = function() { self.executeNextQueueAction(); };
    xhr.send();
};

var _BattleManager_update = BattleManager.update;
BattleManager.update = function() {
    if (combat.qteActive || combat.evasionActive) return;
    _BattleManager_update.call(this);
};
