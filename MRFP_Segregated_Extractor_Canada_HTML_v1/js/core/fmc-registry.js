const REGISTRY=[];
function registerFMC(adapter){
 if(!adapter?.key||typeof adapter.detect!=='function'||typeof adapter.extract!=='function')throw Error('Invalid FMC adapter');
 if(REGISTRY.some(a=>a.key===adapter.key))throw Error('Duplicate FMC '+adapter.key);
 REGISTRY.push(adapter);
}
