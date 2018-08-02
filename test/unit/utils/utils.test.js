const utils = require('../../../utils');
const chai = require('chai');
const mocha = require('mocha');
const expect = chai.expect;

describe('Test function: mergeObjWithBuf', function () {
  let buf1 = {
    a: Buffer.alloc(1),
    b: Buffer.alloc(1),
  };
  let buf2 = {
    a: Buffer.alloc(2),
    c: Buffer.alloc(1),
  };
  let bufExpected = {
    a: Buffer.alloc(2),
    b: Buffer.alloc(1),
    c: Buffer.alloc(1),
  };
  it('merge', function () {
    const bufOut = utils.mergeObjWithBuf(buf1, buf2);
    expect(bufOut).to.deep.equal(bufExpected);
  });
});

describe('Test function: objBuf2Hex', function () {
  let bufObj = {
    a: Buffer.alloc(1),
    b: Buffer.alloc(1),
    c: Buffer.alloc(1),
  };
  const ignoreList = ['b'];
  const bufExpected = {
    a: '00',
    b: Buffer.alloc(1),
    c: '00',
  };
  it('buf to hex', function () {
    const bufOut = utils.objBuf2Hex(bufObj, ignoreList);
    expect(bufOut).to.deep.equal(bufExpected);
    expect(bufObj).not.to.deep.equal(bufOut);
  });
});

