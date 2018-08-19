/*
 * Copyright 2018 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import { CreateGameReducer } from '../core/reducer';
import { MAKE_MOVE, GAME_EVENT } from '../core/action-types';
import { createStore } from 'redux';

export class GameMaster {
  constructor(game, storageAPI, transportAPI, isActionFromAuthenticPlayer) {
    this.game = game;
    this.storageAPI = storageAPI;
    this.transportAPI = transportAPI;
    this.isActionFromAuthenticPlayer = () => true;

    if (isActionFromAuthenticPlayer !== undefined) {
      this.isActionFromAuthenticPlayer = isActionFromAuthenticPlayer;
    }
  }

  async onUpdate(action, stateID, gameID, playerID) {
    let state = await this.storageAPI.get(gameID);

    if (state === undefined) {
      return { error: 'game not found' };
    }

    const reducer = CreateGameReducer({
      game: this.game,
      numPlayers: state.ctx.numPlayers,
    });
    const store = createStore(reducer, state);

    const isActionAuthentic = await this.isActionFromAuthenticPlayer({
      action,
      storageAPI: this.storageAPI,
      gameID,
      playerID,
    });
    if (!isActionAuthentic) {
      return { error: 'unauthorized action' };
    }

    // Check whether the player is allowed to make the move.
    if (
      action.type == MAKE_MOVE &&
      !this.game.flow.canPlayerMakeMove(state.G, state.ctx, playerID)
    ) {
      return;
    }

    // Check whether the player is allowed to call the event.
    if (
      action.type == GAME_EVENT &&
      !this.game.flow.canPlayerCallEvent(state.G, state.ctx, playerID)
    ) {
      return;
    }

    if (state._stateID == stateID) {
      let log = store.getState().log || [];

      // Update server's version of the store.
      store.dispatch(action);
      state = store.getState();

      this.transportAPI.sendAll(playerID => {
        const filteredState = {
          ...state,
          G: this.game.playerView(state.G, state.ctx, playerID),
          ctx: { ...state.ctx, _random: undefined },
          log: undefined,
          deltalog: undefined,
        };

        return {
          type: 'update',
          args: [gameID, filteredState, state.deltalog],
        };
      });

      // TODO: We currently attach the log back into the state
      // object before storing it, but this should probably
      // sit in a different part of the database eventually.
      log = [...log, ...state.deltalog];
      const stateWithLog = { ...state, log };

      await this.storageAPI.set(gameID, stateWithLog);
    }

    return;
  }

  async onSync(gameID, playerID, numPlayers) {
    const reducer = CreateGameReducer({ game: this.game, numPlayers });
    let state = await this.storageAPI.get(gameID);

    if (state === undefined) {
      const store = createStore(reducer);
      state = store.getState();
      await this.storageAPI.set(gameID, state);
    }

    const filteredState = {
      ...state,
      G: this.game.playerView(state.G, state.ctx, playerID),
      ctx: { ...state.ctx, _random: undefined },
      log: undefined,
      deltalog: undefined,
    };

    this.transportAPI.send({
      playerID,
      type: 'sync',
      args: [gameID, filteredState, state.log],
    });

    return;
  }
}
