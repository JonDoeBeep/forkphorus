/// <reference path="phosphorus.ts" />
/// <reference path="utils.ts" />
/// <reference path="i18n.ts" />

// We need to add some declarations for old browser APIs that we use.

interface Document {
  webkitIsFullScreen?: boolean;
  webkitFullscreenElement?: HTMLElement;
  mozCancelFullScreen?(): void;
  webkitCancelFullScreen?(): void;
  webkitExitFullscreen?(): void;
}

interface HTMLElement {
  webkitRequestFullScreen?(e: any): void;
  requestFullScreenWithKeys?(): void;
}

/**
 * Player is an interface and wrapper around the Forkphorus core classes.
 */
namespace P.player {
  /**
   * PlayerError is a special type of error where the Player has special handling for this class of error.
   * For example, it may display a help message instead of the error message in certain conditions such as unsupported project types.
   */
  export class PlayerError extends Error {
    public readonly handledByPlayer: boolean = true;
  }

  /**
   * An error that indicates that this project type is knowingly not supported.
   */
  export class ProjectNotSupportedError extends PlayerError {
    constructor(public type: string) {
      super('Project type (' + type + ') is not supported');
      this.name = 'ProjectNotSupportedError';
    }
  }

  /**
   * An error that indicates that this project does not exist.
   */
  export class ProjectDoesNotExistError extends PlayerError {
    constructor(public id: string) {
      super('Project with ID ' + id + ' does not exist');
      this.name = 'ProjectDoesNotExistError';
    }
  }

  interface ProjectPlayer {
    /** Emitted when there has been an update on loading progress. */
    onprogress: Slot<number>;
    /** Emitted when a Stage has loaded and been added to the player. */
    onload: Slot<P.core.Stage>;
    /** Emitted when a project begins loading. */
    onstartload: Slot<never>;
    /** Emitted when the current stage is removed. */
    oncleanup: Slot<never>;
    /** Emitted when the theme of the player is changed. */
    onthemechange: Slot<Theme>;
    /** Emitted when there is an error. */
    onerror: Slot<any>;
    /** Emitted when a stage is started or resumed. */
    onresume: Slot<never>;
    /** Emitted when the stage is paused. */
    onpause: Slot<never>;
    /** Emitted when options change. The payload only includes the parts that changed. */
    onoptionschange: Slot<Partial<PlayerOptions>>;

    root: HTMLElement;
    controlsContainer: HTMLElement;
    playerContainer: HTMLElement;

    setOptions(options: Partial<PlayerOptions>): void;
    getOptions(): PlayerOptions;

    addControls(options: ControlsOptions): void;

    /** Remove the stage and cancel the loader */
    cleanup(): void;

    /** Resume or start the project's frame loop. */
    resume(): void;
    /** Pause the project's frame loop */
    pause(): void;
    /** Stop the project and the frame loop, akin to the stop sign in Scratch */
    stopAll(): void;
    /** Start the project's scripts and the frame loop, akin to the green flag in Scratch */
    triggerGreenFlag(): void;
    /** Whether the project's frame loop is running. */
    isRunning(): boolean;
    /** Toggle the project's frame loop status. */
    toggleRunning(): void;

    loadProjectById(id: string): Promise<void>;
    loadProjectFromFile(file: File): Promise<void>;
    loadProjectFromBuffer(buffer: ArrayBuffer, type: 'sb2' | 'sb3'): Promise<void>;

    hasStage(): boolean;
    getStage(): P.core.Stage;

    focus(): void;

    enterFullscreen(): void;
    exitFullscreen(): void;

    hasProjectMeta(): boolean;
    getProjectMeta(): ProjectMeta;
  }

  type Theme = 'light' | 'dark';
  type AutoplayPolicy = 'always' | 'if-audio-playable' | 'never';
  type CloudVariables = 'once' | 'off';
  type FullscreenMode = 'full' | 'window';
  interface PlayerOptions {
    theme: Theme;
    autoplayPolicy: AutoplayPolicy;
    turbo: boolean;
    fps: number;
    cloudVariables: CloudVariables;
    username: string;
    fullscreenMode: FullscreenMode;
    fullscreenPadding: number;
    fullscreenMaxWidth: number;
    imageSmoothing: boolean;
  }

  interface ControlsOptions {
    enableFullscreen?: boolean;
    enableFlag?: boolean;
    enableTurbo?: boolean;
    enablePause?: boolean;
    enableStop?: boolean;
  }

  interface ProjectMeta {
    /**
     * Load the metadata. This may involve network requests, so the result is not immediately available.
     */
    load(): Promise<this>;
    /**
     * Returns the cached title loaded by loadMetadata(), if any
     */
    getTitle(): string | null;
    /**
     * Returns the project ID, if any.
     * ID, in this context, refers to project IDs of scratch.mit.edu
     */
    getId(): string | null;
  }

  class LoaderIdentifier {
    private active: boolean = true;
    private loader: P.io.Loader | null = null;

    cancel() {
      if (!this.active) {
        throw new Error('cannot cancel: already cancelled');
      }
      this.active = false;
      if (this.loader) {
        this.loader.abort();
      }
    }

    setLoader(loader: P.io.Loader) {
      if (!this.active) {
        throw new Error('Loading aborted');
      }
      this.loader = loader;
    }

    isActive() {
      return this.active;
    }
  }

  type SlotFn<T> = (t: T) => void;
  class Slot<T> {
    private _listeners: SlotFn<T>[] = [];

    subscribe(fn: SlotFn<T>) {
      this._listeners.push(fn);
    }

    emit(value?: T) {
      for (const listener of this._listeners) {
        listener(value!);
      }
    }
  }

  class LocalProjectMeta implements ProjectMeta {
    constructor(private filename: string) {

    }

    load() {
      return Promise.resolve(this);
    }

    getTitle() {
      return this.filename;
    }

    getId() {
      return null;
    }
  }

  class RemoteProjectMeta implements ProjectMeta {
    private title: string | null = null;
    constructor(private id: string) {

    }

    load() {
      return new P.io.Request('https://scratch.garbomuffin.com/proxy/projects/$id'.replace('$id', this.id))
        .load('json')
        .then((data) => {
          if (data.title) {
            this.title = data.title;
          }
          return this;
        });
    }

    getTitle() {
      return this.title;
    }

    getId() {
      return this.id;
    }
  }

  /**
   * Project player that makes using the forkphorus API less miserable.
   * You MUST ALWAYS use Player.* instead of Player.stage.* when possible to avoid UI desyncs and other weird behavior.
   */
  export class Player implements ProjectPlayer {
    public static readonly DEFAULT_OPTIONS: PlayerOptions = {
      autoplayPolicy: 'always',
      cloudVariables: 'once',
      fps: 30,
      theme: 'light',
      turbo: false,
      username: '',
      fullscreenMode: 'full',
      fullscreenPadding: 8,
      fullscreenMaxWidth: Infinity,
      imageSmoothing: false,
    };

    public onprogress = new Slot<number>();
    public onload = new Slot<P.core.Stage>();
    public onstartload = new Slot<never>();
    public oncleanup = new Slot<never>();
    public onthemechange = new Slot<Theme>();
    public onerror = new Slot<any>();
    public onresume = new Slot<never>();
    public onpause = new Slot<never>();
    public onoptionschange = new Slot<Partial<PlayerOptions>>();

    public root: HTMLElement;
    public playerContainer: HTMLElement;
    public controlsContainer: HTMLElement;

    /** Magic values (such as URLs) that you may want to change. */
    public MAGIC = {
      // A large z-index, used for some fullscreen modes to display on top of everything.
      LARGE_Z_INDEX: '9999999999',
      // $id is replaced with the project's ID
      CLOUD_HISTORY_API: 'https://scratch.garbomuffin.com/cloud-proxy/logs/$id?limit=100',
      // $id is replaced with the project's ID
      PROJECT_API: 'https://projects.scratch.mit.edu/$id',
    };

    private options: Readonly<PlayerOptions>;
    private stage: P.core.Stage;
    private projectMeta: ProjectMeta | null = null;
    private currentLoader: LoaderIdentifier | null = null;
    private fullscreenEnabled: boolean = false;
    private savedTheme: Theme;
    private clickToPlayContainer: HTMLElement | null = null;

    constructor(options: Partial<PlayerOptions> = {}) {
      this.root = document.createElement('div');
      this.root.className = 'player-root';

      this.playerContainer = document.createElement('div');
      this.playerContainer.className = 'player-stage';
      this.root.appendChild(this.playerContainer);

      this.setOptions({ ...options, ...Player.DEFAULT_OPTIONS });

      window.addEventListener('resize', () => this.updateFullscreen());
      document.addEventListener('fullscreenchange', () => this.onfullscreenchange());
      document.addEventListener('mozfullscreenchange', () => this.onfullscreenchange());
      document.addEventListener('webkitfullscreenchange', () => this.onfullscreenchange());

      this.handleError = this.handleError.bind(this);
    }

    // UI HELPERS

    private enableAttribute(name: string): void {
      this.root.setAttribute(name, '');
    }

    private disableAttribute(name: string): void {
      this.root.removeAttribute(name);
    }

    private setAttribute(name: string, enabled: boolean): void {
      if (enabled) {
        this.enableAttribute(name);
      } else {
        this.disableAttribute(name);
      }
    }

    // OPTIONS

    setOptions(changedOptions: Partial<PlayerOptions>): void {
      this.options = { ...this.options, ...changedOptions };

      // Sync some option values
      if (typeof changedOptions.turbo !== 'undefined') {
        this.setAttribute('turbo', changedOptions.turbo);
      }
      if (typeof changedOptions.theme !== 'undefined') {
        this.root.setAttribute('theme', changedOptions.theme);
        this.onthemechange.emit(changedOptions.theme);
      }
      if (this.hasStage()) {
        this.applyOptionsToStage();
      }

      this.onoptionschange.emit(changedOptions);
    }

    getOptions(): PlayerOptions {
      return this.options;
    }

    addControls(options: ControlsOptions = {}): void {
      if (this.controlsContainer) {
        throw new Error('This player already has controls.');
      }

      let flagTouchTimeout: number | null | undefined = undefined;

      const clickStop = (e: MouseEvent) => {
        this.throwWithoutStage();
        this.stopAll();
        this.stage.draw();
        e.preventDefault();
      };

      const clickPause = (e: MouseEvent) => {
        this.toggleRunning();
      };

      const clickFullscreen = (e: MouseEvent) => {
        this.throwWithoutStage();
        this.setOptions({ fullscreenMode: e.shiftKey ? 'window' : 'full' });
        if (this.fullscreenEnabled) {
          this.exitFullscreen();
        } else {
          this.enterFullscreen();
        }
      };

      const clickFlag = (e: MouseEvent) => {
        if (flagTouchTimeout === null) {
          return;
        }
        if (flagTouchTimeout) {
          clearTimeout(flagTouchTimeout);
        }
        this.throwWithoutStage();
        if (e.shiftKey) {
          this.setOptions({ turbo: !this.options.turbo });
        } else {
          this.triggerGreenFlag();
        }
        this.focus();
        e.preventDefault();
      };

      const startTouchFlag = (e: MouseEvent) => {
        flagTouchTimeout = setTimeout(() => {
          flagTouchTimeout = null;
          this.setOptions({ turbo: !this.options.turbo });
        }, 500);
      };

      const preventDefault = (e: Event) => {
        e.preventDefault();
      };

      this.controlsContainer = document.createElement('div');
      this.controlsContainer.className = 'player-controls';

      if (options.enableStop !== false) {
        var stopButton = document.createElement('span');
        stopButton.className = 'player-button player-stop';
        this.controlsContainer.appendChild(stopButton);
        stopButton.addEventListener('click', clickStop);
        stopButton.addEventListener('touchend', clickStop);
        stopButton.addEventListener('touchstart', preventDefault);
      }

      if (options.enablePause !== false) {
        var pauseButton = document.createElement('span');
        pauseButton.className = 'player-button player-pause';
        this.controlsContainer.appendChild(pauseButton);
        pauseButton.addEventListener('click', clickPause);
        pauseButton.addEventListener('touchend', clickPause);
        pauseButton.addEventListener('touchstart', preventDefault);
      }

      if (options.enableFlag !== false) {
        var flagButton = document.createElement('span');
        flagButton.className = 'player-button player-flag';
        flagButton.title = P.i18n.translate('player.controls.flag.title');
        this.controlsContainer.appendChild(flagButton);
        flagButton.addEventListener('click', clickFlag);
        flagButton.addEventListener('touchend', clickFlag)
        flagButton.addEventListener('touchstart', startTouchFlag);
        flagButton.addEventListener('touchstart', preventDefault);
      }

      if (options.enableTurbo !== false) {
        var turboText = document.createElement('span');
        turboText.innerText = P.i18n.translate('player.controls.turboIndicator');
        turboText.className = 'player-label player-turbo';
        this.controlsContainer.appendChild(turboText);

        this.onoptionschange.subscribe((options) => {
          if (flagButton && typeof options.turbo === 'boolean') {
            if (options.turbo) {
              flagButton.title = P.i18n.translate('player.controls.flag.title.enabled');
            } else {
              flagButton.title = P.i18n.translate('player.controls.flag.title.disabled');
            }
          }
        });
      }

      if (options.enableFullscreen !== false) {
        var fullscreenButton = document.createElement('span');
        fullscreenButton.className = 'player-button player-fullscreen-btn';
        fullscreenButton.title = P.i18n.translate('player.controls.fullscreen.title');
        this.controlsContainer.appendChild(fullscreenButton);
        fullscreenButton.addEventListener('click', clickFullscreen);
        fullscreenButton.addEventListener('touchend', clickFullscreen);
        fullscreenButton.addEventListener('touchstart', preventDefault);
      }

      this.root.addEventListener('touchmove', (e) => {
        if (this.fullscreenEnabled) {
          e.preventDefault();
        }
      });

      this.root.insertBefore(this.controlsContainer, this.root.firstChild);
    }

    /**
     * Apply local options to a stage
     */
    private applyOptionsToStage(): void {
      // Changing FPS involved restarting an interval, which may cause a noticable interruption.
      if (this.stage.runtime.framerate !== this.options.fps) {
        this.stage.runtime.framerate = this.options.fps;
        if (this.isRunning()) {
          this.stage.runtime.resetInterval();
        }
      }
      this.stage.username = this.options.username;
      this.stage.runtime.isTurbo = this.options.turbo;
      (this.stage.renderer as P.renderer.canvas2d.ProjectRenderer2D).imageSmoothingEnabled = this.options.imageSmoothing;
    }

    // COMMON OPERATIONS

    /**
     * Throw an error if there is no stage available.
     */
    private throwWithoutStage() {
      if (!this.stage) {
        throw new Error('Missing stage.');
      }
    }

    resume(): void {
      this.throwWithoutStage();
      if (this.isRunning()) {
        throw new Error('cannot resume: project is already running');
      }
      this.stage.runtime.start();
      this.enableAttribute('running');
      this.onresume.emit();
    }

    pause(): void {
      this.throwWithoutStage();
      if (!this.isRunning()) {
        throw new Error('cannot pause: project is already paused');
      }
      this.stage.runtime.pause();
      this.disableAttribute('running');
      this.onpause.emit();
    }

    isRunning() {
      if (!this.hasStage()) {
        return false;
      }
      return this.stage.runtime.isRunning;
    }

    toggleRunning(): void {
      this.throwWithoutStage();
      if (this.stage.runtime.isRunning) {
        this.pause();
      } else {
        this.resume();
      }
    }

    stopAll(): void {
      this.throwWithoutStage();
      this.pause();
      this.stage.runtime.stopAll();
    }

    triggerGreenFlag(): void {
      this.throwWithoutStage();
      if (!this.isRunning()) {
        this.resume();
      }
      this.stage.runtime.stopAll();
      this.stage.runtime.triggerGreenFlag();
      if (this.clickToPlayContainer) {
        this.removeClickToPlayContainer();
      }
    }

    cleanup() {
      // Stop any loader
      if (this.currentLoader) {
        this.currentLoader.cancel();
        this.currentLoader = null;
      }
      // Reset interface
      if (this.clickToPlayContainer) {
        this.removeClickToPlayContainer();
      }
      if (this.fullscreenEnabled) {
        this.exitFullscreen();
      }
      // Remove stage
      if (this.stage) {
        this.stage.destroy();
        this.stage = null!;
      }
      // Clear some additional data
      this.projectMeta = null;
      while (this.playerContainer.firstChild) {
        this.playerContainer.removeChild(this.playerContainer.firstChild);
      }
      this.oncleanup.emit();
    }

    focus() {
      this.stage.focus();
    }

    hasStage(): boolean {
      return !!this.stage;
    }

    getStage(): core.Stage {
      this.throwWithoutStage();
      return this.stage;
    }

    hasProjectMeta() {
      return !!this.projectMeta;
    }

    getProjectMeta() {
      if (!this.projectMeta) {
        throw new Error('no project meta');
      }
      return this.projectMeta;
    }

    handleError(error: any) {
      console.error(error);
      this.onerror.emit(error);
    }

    // FULLSCREEN

    enterFullscreen() {
      // fullscreen requires dark theme
      this.savedTheme = this.root.getAttribute('theme') as Theme;
      this.setOptions({ theme: 'dark' });

      if (this.options.fullscreenMode === 'full') {
        if (this.root.requestFullScreenWithKeys) {
          this.root.requestFullScreenWithKeys();
        } else if (this.root.webkitRequestFullScreen) {
          this.root.webkitRequestFullScreen((Element as any).ALLOW_KEYBOARD_INPUT);
        } else if (this.root.requestFullscreen) {
          this.root.requestFullscreen();
        }
      }

      document.body.classList.add('player-body-fullscreen');
      this.root.style.zIndex = this.MAGIC.LARGE_Z_INDEX;
      this.enableAttribute('fullscreen');
      this.fullscreenEnabled = true;

      if (this.hasStage()) {
        if (!this.isRunning()) {
          this.stage.draw();
        }
        this.focus();
      }

      this.updateFullscreen();
    }

    exitFullscreen() {
      this.setOptions({ theme: this.savedTheme });
      this.disableAttribute('fullscreen');
      this.fullscreenEnabled = false;

      if (document.fullscreenElement === this.root || document.webkitFullscreenElement === this.root) {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen();
        } else if (document.webkitCancelFullScreen) {
          document.webkitCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }

      this.root.style.paddingLeft = '';
      this.root.style.paddingTop = '';
      this.root.style.zIndex = '';
      if (this.controlsContainer) {
        this.controlsContainer.style.width = '';
      }
      document.body.classList.remove('player-body-fullscreen');

      if (this.stage) {
        this.stage.setZoom(1);
        this.focus();
      }
    }

    /**
     * Updates the stage in fullscreen mode to ensure proper dimensions.
     */
    private updateFullscreen() {
      if (!this.fullscreenEnabled) {
        return;
      }
      this.throwWithoutStage();
      const controlsHeight = this.controlsContainer ? this.controlsContainer.offsetHeight : 0;
      window.scrollTo(0, 0);

      let w = window.innerWidth - this.options.fullscreenPadding * 2;
      let h = window.innerHeight - this.options.fullscreenPadding - controlsHeight;
      w = Math.min(w, h / 0.75);
      w = Math.min(w, this.options.fullscreenMaxWidth);
      h = w * 0.75 + controlsHeight;

      if (this.controlsContainer) {
        this.controlsContainer.style.width = w + 'px';
      }

      this.root.style.paddingLeft = (window.innerWidth - w) / 2 + 'px';
      this.root.style.paddingTop = (window.innerHeight - h - this.options.fullscreenPadding) / 2 + 'px';
      this.stage.setZoom(w / 480);
    }

    /**
     * Responds to changes in the browser's fullscreen state.
     */
    private onfullscreenchange() {
      // If the user closes fullscreen through some external method (probably pressing escape),
      // we will want to cleanup and go back to the normal display mode.
      if (typeof document.fullscreen === 'boolean' && document.fullscreen !== this.fullscreenEnabled) {
        this.exitFullscreen();
      } else if (typeof document.webkitIsFullScreen === 'boolean' && document.webkitIsFullScreen !== this.fullscreenEnabled) {
        this.exitFullscreen();
      }
    }

    // CLOUD VARIABLES

    private isCloudVariable(variableName: string): boolean {
      return variableName.startsWith('☁');
    }

    private async getCloudVariables(id: string): Promise<ObjectMap<any>> {
      // To get the cloud variables of a project, we will fetch the history logs and essentially replay the latest changes.
      // This is primarily designed so that highscores in projects can remain up-to-date, and nothing more than that.
      const data = await new P.io.Request(this.MAGIC.CLOUD_HISTORY_API.replace('$id', id)).load('json');
      const variables = Object.create(null);
      for (const entry of data.reverse()) {
        const { verb, name, value } = entry;
        // Make sure that the cloud logs are only affecting cloud variables and not regular variables
        if (!this.isCloudVariable(name)) {
          console.warn('cloud variable logs affecting non-cloud variable, skipping', name);
          continue;
        }
        switch (verb) {
          case 'create_var':
          case 'set_var':
            variables[name] = value;
            break;
          case 'del_var':
            delete variables[name];
            break;
          case 'rename_var':
            variables[value] = variables[name];
            delete variables[name];
            break;
          default:
            console.warn('unknown cloud variable log verb', verb);
        }
      }
      return variables;
    }

    private addCloudVariables(stage: P.core.Stage, id: string) {
      const variables = Object.keys(stage.vars);
      const hasCloudVariables = variables.some(this.isCloudVariable);
      if (!hasCloudVariables) {
        return;
      }
      this.getCloudVariables(id).then((variables) => {
        for (const name of Object.keys(variables)) {
          // Ensure that the variables we are setting are known to the stage before setting them.
          if (name in stage.vars) {
            stage.vars[name] = variables[name];
          } else {
            console.warn('not applying unknown cloud variable:', name);
          }
        }
      });
    }

    // AUTOPLAY POLICY

    /**
     * Apply an autoplay policy to the current stage.
     */
    private enactAutoplayPolicy(policy: AutoplayPolicy) {
      switch (policy) {
        case 'always': {
          this.triggerGreenFlag();
          break;
        }
        case 'if-audio-playable': {
          if (!P.audio.context || P.audio.context.state === 'running') {
            this.triggerGreenFlag();
          } else {
            this.showClickToPlayContainer();
          }
          break;
        }
        case 'never': {
          this.showClickToPlayContainer();
          break;
        }
      }
    }

    private showClickToPlayContainer() {
      if (this.clickToPlayContainer) {
        throw new Error('cannot show click-to-play interface: already shown');
      }
      this.clickToPlayContainer = document.createElement('div');
      this.clickToPlayContainer.className = 'player-click-to-play-container';
      this.clickToPlayContainer.onclick = () => {
        this.removeClickToPlayContainer();
        this.triggerGreenFlag();
        this.focus();
      };

      const content = document.createElement('div');
      content.className = 'player-click-to-play-icon';
      this.clickToPlayContainer.appendChild(content);

      this.stage.ui.appendChild(this.clickToPlayContainer);
    }

    private removeClickToPlayContainer() {
      if (this.clickToPlayContainer === null) {
        throw new Error('cannot hide click-to-play interface: already hidden');
      }
      this.stage.ui.removeChild(this.clickToPlayContainer);
      this.clickToPlayContainer = null;
    }

    // PROJECT LOADERS & HELPERS

    /**
     * Begin loading a new project.
     * This gives you a LoaderIdentifier to use for identification and cancellation.
     * It also removes any existing stage to make room for the new one.
     */
    private beginLoadingProject(): { loaderId: LoaderIdentifier } {
      this.cleanup();
      this.onstartload.emit();
      const loaderId = new LoaderIdentifier();
      this.currentLoader = loaderId;
      return { loaderId };
    }

    /**
     * Determine project type by its data.
     * @param data The project's data (project.json)
     */
    private determineProjectType(data: any): 'sb2' | 'sb3' {
      if ('objName' in data) return 'sb2';
      if ('targets' in data) return 'sb3';
      throw new Error('Unknown project type');
    }

    /**
     * Determine if a project file is a Scratch 1 project.
     */
    private isScratch1Project(buffer: ArrayBuffer) {
      const MAGIC = 'ScratchV0';
      const array = new Uint8Array(buffer);
      for (var i = 0; i < MAGIC.length; i++) {
        if (String.fromCharCode(array[i]) !== MAGIC[i]) {
          return false;
        }
      }
      return true;
    }

    /**
     * Download a project from the scratch.mit.edu using its ID.
     */
    private fetchProject(id: string): Promise<Blob> {
      const request = new P.io.Request(this.MAGIC.PROJECT_API.replace('$id', id));
      return request
        .ignoreErrors()
        .load('blob')
        .then(function(response) {
          if (request.getStatus() === 404) {
            throw new ProjectDoesNotExistError(id);
          }
          return response;
        });
    }

    /**
     * Set the stage of this loader. Applies options to the stage, among other things.
     */
    private setStage(stage: P.core.Stage) {
      this.stage = stage;
      this.stage.runtime.handleError = this.handleError;
      this.applyOptionsToStage();

      this.playerContainer.appendChild(stage.root);
      stage.focus();
      stage.draw();
      this.onload.emit(stage);

      this.enactAutoplayPolicy(this.options.autoplayPolicy);
    }

    /**
     * Sets the active loader of this stage.
     * @param loaderId LoaderIdentifier as given by startLoadingProject()
     * @param loader The new loader
     */
    private async loadLoader(loaderId: LoaderIdentifier, loader: P.io.Loader<P.core.Stage>): Promise<P.core.Stage> {
      loaderId.setLoader(loader);
      loader.onprogress = (progress) => {
        if (loaderId.isActive()) {
          this.onprogress.emit(progress);
        }
      };
      const stage = await loader.load();
      this.setStage(stage);
      return stage;
    }

    private async loadProjectFromBufferWithType(loaderId: LoaderIdentifier, buffer: ArrayBuffer, type: 'sb2' | 'sb3'): Promise<void> {
      let loader: P.io.Loader<P.core.Stage>;
      switch (type) {
        case 'sb2': loader = new P.sb2.SB2FileLoader(buffer); break;
        case 'sb3': loader = new P.sb3.SB3FileLoader(buffer); break;
        default: throw new Error('Unknown type: ' + type);
      }
      await this.loadLoader(loaderId, loader);
    }

    async loadProjectById(id: string): Promise<void> {
      const { loaderId } = this.beginLoadingProject();

      const getLoader = async (blob: Blob): Promise<P.io.Loader<P.core.Stage>> => {
        // When downloaded from scratch.mit.edu, there are two types of projects:
        // 1. "JSON projects" which are only the project.json of a sb2 or sb3 file.
        //    This is most projects, especially as this is the only format of Scratch 3 projects.
        // 2. "Binary projects" which are full binary .sb or .sb2 files.
        //    As an example: https://scratch.mit.edu/projects/250740608/

        const projectText = await P.io.readers.toText(blob);
        try {
          // JSON.parse will fail if this is not a JSON project
          const projectJson = JSON.parse(projectText);

          switch (this.determineProjectType(projectJson)) {
            case 'sb2': return new P.sb2.Scratch2Loader(projectJson);
            case 'sb3': return new P.sb3.Scratch3Loader(projectJson);
          }
        } catch (e) {
          // if the project cannot be loaded as JSON, it may be a binary project.
          const buffer = await P.io.readers.toArrayBuffer(blob);

          // check for Scratch 1, which we do not support
          if (this.isScratch1Project(buffer)) {
            throw new ProjectNotSupportedError('Scratch 1');
          }

          return new P.sb2.SB2FileLoader(buffer);
        }
      };

      try {
        this.projectMeta = new RemoteProjectMeta(id);
        const blob = await this.fetchProject(id);
        const loader = await getLoader(blob);
        const stage = await this.loadLoader(loaderId, loader);
        this.addCloudVariables(stage, id);
      } catch (e) {
        if (loaderId.isActive()) {
          this.handleError(e);
        }
      }
    }

    async loadProjectFromFile(file: File): Promise<void> {
      const { loaderId } = this.beginLoadingProject();

      try {
        this.projectMeta = new LocalProjectMeta(file.name);
        const extension = file.name.split('.').pop() || '';
        const buffer = await P.io.readers.toArrayBuffer(file);

        switch (extension) {
          case 'sb2': return this.loadProjectFromBufferWithType(loaderId, buffer, 'sb2');
          case 'sb3': return this.loadProjectFromBufferWithType(loaderId, buffer, 'sb3');
          default: throw new Error('Unrecognized file extension: ' + extension);
        }
      } catch (e) {
        if (loaderId.isActive()) {
          this.handleError(e);
        }
      }
    }

    async loadProjectFromBuffer(buffer: ArrayBuffer, type: 'sb2' | 'sb3'): Promise<void> {
      const { loaderId } = this.beginLoadingProject();

      try {
        return await this.loadProjectFromBufferWithType(loaderId, buffer, type);
      } catch (e) {
        if (loaderId.isActive()) {
          this.handleError(e);
        }
      }
    }
  }

  interface ErrorHandlerOptions {
    container?: HTMLElement;
  }

  /**
   * Error handler UI for Player
   */
  export class ErrorHandler {
    public static BUG_REPORT_LINK = 'https://github.com/forkphorus/forkphorus/issues/new?title=$title&body=$body';

    private errorEl: HTMLElement | null;
    private errorContainer: HTMLElement | null;

    constructor(public player: ProjectPlayer, options: ErrorHandlerOptions = {}) {
      this.player = player;
      player.onerror.subscribe(this.onerror.bind(this));
      player.oncleanup.subscribe(this.oncleanup.bind(this));
      this.errorEl = null;
      if (options.container) {
        this.errorContainer = options.container;
      } else {
        this.errorContainer = null;
      }
    }

    /**
     * Create a string representation of an error.
     */
    stringifyError(error: any): string {
      if (!error) {
        return 'unknown error';
      }
      if (error.stack) {
        return 'Message: ' + error.message + '\nStack:\n' + error.stack;
      }
      return error.toString();
    }

    /**
     * Generate the link to report a bug to, including title and metadata.
     */
    createBugReportLink(bodyBefore: string, bodyAfter: string): string {
      var title = this.getBugReportTitle();
      bodyAfter = bodyAfter || '';
      var body =
        bodyBefore +
        '\n\n\n-----\n' +
        this.getBugReportMetadata() +
        '\n' +
        bodyAfter;
      return ErrorHandler.BUG_REPORT_LINK
        .replace('$title', encodeURIComponent(title))
        .replace('$body', encodeURIComponent(body));
    }

    /**
     * Get the title for bug reports.
     */
    getBugReportTitle(): string {
      const meta = this.player.getProjectMeta();
      const title = meta.getTitle();
      const id = meta.getId();
      if (title) {
        return title;
      }
      if (id) {
        return id;
      }
      return 'Unknown Project';
    }

    /**
     * Get the metadata to include in bug reports.
     */
    getBugReportMetadata(): string {
      var meta = '';
      meta += 'Project ID: ' + this.player.getProjectMeta().getId() + '\n';
      meta += location.href + '\n';
      meta += navigator.userAgent;
      return meta;
    }

    /**
     * Get the URL to report an error to.
     */
    createErrorLink(error: any): string {
      var body = P.i18n.translate('player.errorhandler.instructions');
      return this.createBugReportLink(body, '```\n' + this.stringifyError(error) + '\n```');
    }

    oncleanup(): void {
      if (this.errorEl && this.errorEl.parentNode) {
        this.errorEl.parentNode.removeChild(this.errorEl);
        this.errorEl = null;
      }
    }

    /**
     * Create an error element indicating that forkphorus has crashed, and where to report the bug.
     */
    handleError(error: any): HTMLElement {
      var el = document.createElement('div');
      var errorLink = this.createErrorLink(error);
      var attributes = 'href="' + errorLink + '" target="_blank" ref="noopener"';
      // use of innerHTML intentional
      el.innerHTML = P.i18n.translate('player.errorhandler.error').replace('$attrs', attributes);
      return el;
    }

    /**
     * Create an error element indicating this project is not supported.
     */
    handleNotSupportedError(error: ProjectNotSupportedError): HTMLElement {
      var el = document.createElement('div');
      // use of innerHTML intentional
      el.innerHTML = P.i18n.translate('player.errorhandler.error.unsupported').replace('$type', error.type);
      return el;
    }

    /**
     * Create an error element indicating this project does not exist.
     */
    handleDoesNotExistError(error: ProjectDoesNotExistError): HTMLElement {
      var el = document.createElement('div');
      el.textContent = P.i18n.translate('player.errorhandler.error.doesnotexist').replace('$id', error.id);
      return el;
    }

    onerror(error: any): void {
      var el = document.createElement('div');
      el.className = 'player-error';
      // Special handling for certain errors to provide a better error message
      if (error instanceof ProjectNotSupportedError) {
        el.appendChild(this.handleNotSupportedError(error));
      } else if (error instanceof ProjectDoesNotExistError) {
        el.appendChild(this.handleDoesNotExistError(error));
      } else {
        el.appendChild(this.handleError(error));
      }
      if (this.errorContainer) {
        this.errorContainer.appendChild(el);
      } else if (this.player.hasStage()) {
        this.player.getStage().ui.appendChild(el);
      } else {
        this.player.playerContainer.appendChild(el);
      }
      this.errorEl = el;
    }
  }

  interface ProgressBarOptions {
    position?: 'controls' | HTMLElement;
  }

  /**
   * Loading progress bar for Player
   */
  export class ProgressBar {
    private el: HTMLElement;
    private bar: HTMLElement;

    constructor(player: ProjectPlayer, options: ProgressBarOptions = {}) {
      this.el = document.createElement('div');
      this.el.className = 'player-progress';

      this.bar = document.createElement('div');
      this.bar.className = 'player-progress-fill';
      this.el.appendChild(this.bar);

      this.setTheme(player.getOptions().theme);

      player.onthemechange.subscribe((theme) => this.setTheme(theme));
      player.onprogress.subscribe((progress) => this.setProgress(progress));
      player.onstartload.subscribe(() => {
        this.el.setAttribute('state', 'loading');
        this.setProgress(0);
      });
      player.onload.subscribe(() => {
        this.el.setAttribute('state', 'loaded');
      });
      player.oncleanup.subscribe(() => {
        this.el.setAttribute('state', '');
        this.bar.style.width = '0%';
      });
      player.onerror.subscribe(() => {
        this.el.setAttribute('state', 'error');
        this.bar.style.width = '100%';
      });

      if (options.position === 'controls' || options.position === undefined) {
        if (!player.controlsContainer) {
          throw new Error('No controls to put progess bar in.');
        }
        player.controlsContainer.appendChild(this.el);
      } else {
        options.position.appendChild(this.el);
      }
    }

    private setTheme(theme: Theme) {
      this.el.setAttribute('theme', theme);
    }

    setProgress(progress: number) {
      this.bar.style.width = 10 + progress * 90 + '%';
    }
  }
}
