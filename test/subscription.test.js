'use strict'

const _ = require('lodash')
const nock = require('nock')
nock.enableNetConnect(['localhost'])
const ratesResponse = require('./data/fxRates.json')
const appHelper = require('./helpers/app')
const logger = require('../src/common/log')
const logHelper = require('./helpers/log')
const wsHelper = require('./helpers/ws')
const sinon = require('sinon')
const IlpPacket = require('ilp-packet')
const { assert } = require('chai')

const mockPlugin = require('./mocks/mockPlugin')
const mock = require('mock-require')
mock('ilp-plugin-mock', mockPlugin)

const START_DATE = 1434412800000 // June 16, 2015 00:00:00 GMT

describe('Subscriptions', function () {
  logHelper(logger)

  beforeEach(async function () {
    this.clock = sinon.useFakeTimers(START_DATE)
    appHelper.create(this)
    await this.backend.connect(ratesResponse)
    await this.accounts.connect()
    await this.routeBroadcaster.reloadLocalRoutes()
    await this.middlewareManager.setup()

    const testAccounts = ['cad-ledger', 'usd-ledger', 'eur-ledger', 'cny-ledger']
    for (let accountId of testAccounts) {
      await this.accounts.getPlugin(accountId)._dataHandler(Buffer.from(JSON.stringify({
        method: 'broadcast_routes',
        data: {
          speaker: accountId,
          routing_table_id: 'bc1ddf0e-1156-4277-bdf0-a75974e37dbe',
          hold_down_time: 45000,
          from_epoch: 0,
          to_epoch: 1,
          new_routes: [{prefix: accountId, path: []}],
          withdrawn_routes: []
        }
      })))
    }

    nock('http://usd-ledger.example').get('/accounts/mark')
      .reply(200, {
        ledger: 'http://usd-ledger.example',
        name: 'mark',
        connector: 'http://localhost'
      })

    nock('http://eur-ledger.example').get('/accounts/mark')
      .reply(200, {
        ledger: 'http://eur-ledger.example',
        name: 'mark',
        connector: 'http://localhost'
      })

    nock('http://cad-ledger.example:1000').get('/accounts/mark')
      .reply(200, {
        ledger: 'http://cad-ledger.example:1000',
        name: 'mark',
        connector: 'http://localhost'
      })

    nock('http://cny-ledger.example').get('/accounts/mark')
      .reply(200, {
        ledger: 'http://cny-ledger.example',
        name: 'mark',
        connector: 'http://localhost'
      })

    this.setTimeout = setTimeout

    this.transferUsdPrepared = _.cloneDeep(require('./data/transferUsdPrepared.json'))
    this.transferEurProposed = _.cloneDeep(require('./data/transferEurProposed.json'))
  })

  afterEach(async function () {
    nock.cleanAll()
    this.clock.restore()
  })

  it('should initiate and complete a universal mode payment', async function () {
    const sourceAccount = 'usd-ledger'
    const destinationAccount = 'eur-ledger'
    const destination = 'eur-ledger.bob'
    const executionCondition = Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64')
    const expiresAt = new Date('2015-06-16T00:00:11.000Z')
    const data = Buffer.from('BABA', 'base64')
    const sourceAmount = '10700'
    const destinationAmount = '10081'
    const ilpFulfill = {
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.from('ABAB', 'base64')
    }
    const sendStub = sinon.stub(this.accounts.getPlugin(destinationAccount), 'sendData')
      .resolves(IlpPacket.serializeIlpFulfill(ilpFulfill))

    const result = await this.accounts.getPlugin(sourceAccount)
      ._dataHandler(IlpPacket.serializeIlpPrepare({
        amount: sourceAmount,
        executionCondition,
        expiresAt,
        destination,
        data
      }))

    sinon.assert.calledOnce(sendStub)
    sinon.assert.calledWith(sendStub, sinon.match(packet => assert.deepEqual(IlpPacket.deserializeIlpPrepare(packet), {
      amount: destinationAmount,
      executionCondition,
      expiresAt: new Date(expiresAt - 1000),
      destination,
      data
    }) || true))
    assert.deepEqual(IlpPacket.deserializeIlpFulfill(result), ilpFulfill)
  })

  it('should notify the backend of a successful payment', async function () {
    const sourceAccount = 'usd-ledger'
    const destinationAccount = 'eur-ledger'
    const destination = 'eur-ledger.bob'
    const executionCondition = Buffer.from('uzoYx3K6u+Nt6kZjbN6KmH0yARfhkj9e17eQfpSeB7U=', 'base64')
    const expiresAt = new Date('2015-06-16T00:00:11.000Z')
    const data = Buffer.from('BABA', 'base64')
    const sourceAmount = '10700'
    const destinationAmount = '10081'
    const ilpFulfill = {
      fulfillment: Buffer.from('HS8e5Ew02XKAglyus2dh2Ohabuqmy3HDM8EXMLz22ok', 'base64'),
      data: Buffer.from('ABAB', 'base64')
    }
    sinon.stub(this.accounts.getPlugin(destinationAccount), 'sendData')
      .resolves(IlpPacket.serializeIlpFulfill(ilpFulfill))
    sinon.stub(this.accounts.getPlugin(destinationAccount), 'sendMoney')
      .resolves()
    const backendSpy = sinon.spy(this.backend, 'submitPayment')

    await this.accounts.getPlugin(sourceAccount)
      ._dataHandler(IlpPacket.serializeIlpPrepare({
        amount: sourceAmount,
        executionCondition,
        expiresAt,
        destination,
        data
      }))

    sinon.assert.calledOnce(backendSpy)
    sinon.assert.calledWith(backendSpy, {
      sourceAccount,
      sourceAmount,
      destinationAccount,
      destinationAmount
    })
  })
})
