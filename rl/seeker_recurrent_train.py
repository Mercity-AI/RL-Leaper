"""Recurrent PPO with <=128-step learning chunks and <=32-step detached burn-in.

Uses SB3-contrib collection/GAE/timeout handling unchanged. Raw rollout arrays stay
time-major; stock get() (which reshapes them) is never called. Every valid token is
learned exactly once per epoch, in batches of 256 valid tokens. Padding and burn-in
are excluded from every PPO loss and advantage normalization.
"""
from dataclasses import dataclass
import numpy as np
import torch
from sb3_contrib import RecurrentPPO
from sb3_contrib.common.recurrent.type_aliases import RNNStates
from stable_baselines3.common.utils import explained_variance


@dataclass(frozen=True)
class Segment:
    worker: int
    start: int
    stop: int
    warm_start: int


def learning_batches(buffer,batch_size=256,chunk_size=128,burn_in=32):
    """Shuffle whole contiguous chunks, then split only to fill valid-token batches."""
    if buffer.generator_ready:
        raise RuntimeError('Raw recurrent buffer required; stock get() has reshaped it')
    if not buffer.full:
        raise RuntimeError('Incomplete rollout')
    chunks=[]
    for worker in range(buffer.n_envs):
        starts=np.flatnonzero(buffer.episode_starts[:,worker]>0).tolist()
        boundaries=sorted(set([0,*starts,buffer.buffer_size]))
        for episode_start,episode_stop in zip(boundaries[:-1],boundaries[1:]):
            for start in range(episode_start,episode_stop,chunk_size):
                chunks.append((worker,start,min(start+chunk_size,episode_stop),episode_start))
    batch=[];tokens=0
    for index in np.random.permutation(len(chunks)):
        worker,start,stop,episode_start=chunks[index]
        while start<stop:
            end=min(stop,start+batch_size-tokens)
            batch.append(Segment(worker,start,end,max(episode_start,start-burn_in)))
            tokens+=end-start
            start=end
            if tokens==batch_size:
                yield batch
                batch=[];tokens=0
    if batch:yield batch


def prepare_batch(policy,buffer,segments,device):
    """Refresh cached states without gradients; pad only after each learning prefix."""
    def tensor(value):return torch.as_tensor(value,dtype=torch.float32,device=device)
    def saved_state(segment):
        w,t=segment.worker,segment.warm_start
        fields=[tensor(getattr(buffer,name)[t,:,w:w+1,:]) for name in
            ('hidden_states_pi','cell_states_pi','hidden_states_vf','cell_states_vf')]
        # Reset here so the sequence forward can use its no-reset fast path.
        if buffer.episode_starts[t,w]>0:
            fields=[torch.zeros_like(v) for v in fields]
        return RNNStates(tuple(fields[:2]),tuple(fields[2:]))
    states=[None]*len(segments)
    # Group equal burn-in lengths to process several chunks in one LSTM call.
    groups={}
    for i,s in enumerate(segments):groups.setdefault(s.start-s.warm_start,[]).append(i)
    warm_tokens=0
    for length,indices in groups.items():
        cached=[saved_state(segments[i]) for i in indices]
        state=RNNStates(tuple(torch.cat([s.pi[k] for s in cached],dim=1) for k in (0,1)),
                        tuple(torch.cat([s.vf[k] for s in cached],dim=1) for k in (0,1)))
        if length:
            obs=tensor(np.stack([buffer.observations[segments[i].warm_start:segments[i].start,segments[i].worker]
                                  for i in indices])).reshape(-1,*buffer.obs_shape)
            with torch.no_grad():
                _,_,_,state=policy.forward(obs,state,torch.zeros(len(indices)*length,device=device),deterministic=True)
            warm_tokens+=length*len(indices)
        for j,i in enumerate(indices):
            states[i]=RNNStates(tuple(v[:,j:j+1].detach() for v in state.pi),
                                tuple(v[:,j:j+1].detach() for v in state.vf))
    state=RNNStates(tuple(torch.cat([s.pi[k] for s in states],dim=1) for k in (0,1)),
                    tuple(torch.cat([s.vf[k] for s in states],dim=1) for k in (0,1)))
    width=max(s.stop-s.start for s in segments)
    n=len(segments)
    data={}
    for key in ('observations','actions','values','log_probs','advantages','returns'):
        source=getattr(buffer,key)
        packed=np.zeros((n,width,*source.shape[2:]),dtype=source.dtype)
        for i,s in enumerate(segments):
            packed[i,:s.stop-s.start]=source[s.start:s.stop,s.worker]
        data[key]=tensor(packed).reshape(n*width,*source.shape[2:])
    mask=np.zeros((n,width),bool)
    for i,s in enumerate(segments):mask[i,:s.stop-s.start]=True
    data.update(mask=torch.as_tensor(mask.reshape(-1),device=device),states=state,
        episode_starts=torch.zeros(n*width,device=device),warm_tokens=warm_tokens,
        padding_tokens=int((~mask).sum()),valid_tokens=int(mask.sum()))
    return data


class FixedContextRecurrentPPO(RecurrentPPO):
    """Box-action PPO; inherited collection correctly retains/reset h/c per worker."""
    def train(self):
        self.policy.set_training_mode(True)
        self._update_learning_rate(self.policy.optimizer)
        clip=self.clip_range(self._current_progress_remaining)
        clip_vf=self.clip_range_vf(self._current_progress_remaining) if self.clip_range_vf else None
        logs={k:[] for k in ('entropy_loss','policy_gradient_loss','value_loss','approx_kl','clip_fraction','gradient_norm')}
        learned=warm=padding=updates=0
        continue_training=True
        for epoch in range(self.n_epochs):
            for segments in learning_batches(self.rollout_buffer,self.batch_size):
                b=prepare_batch(self.policy,self.rollout_buffer,segments,self.device)
                mask=b['mask']
                values,log_prob,entropy=self.policy.evaluate_actions(b['observations'],b['actions'],b['states'],b['episode_starts'])
                values=values.flatten()
                advantages=b['advantages']
                if self.normalize_advantage and mask.sum()>1:
                    advantages=(advantages-advantages[mask].mean())/(advantages[mask].std()+1e-8)
                ratio=(log_prob-b['log_probs']).exp()
                policy_loss=-torch.minimum(advantages*ratio,advantages*ratio.clamp(1-clip,1+clip))[mask].mean()
                values_pred=values if clip_vf is None else b['values']+(values-b['values']).clamp(-clip_vf,clip_vf)
                value_loss=(b['returns']-values_pred).square()[mask].mean()
                entropy_loss=log_prob[mask].mean() if entropy is None else -entropy[mask].mean()
                loss=policy_loss+self.vf_coef*value_loss+self.ent_coef*entropy_loss
                with torch.no_grad():
                    log_ratio=log_prob-b['log_probs']
                    kl=((log_ratio.exp()-1)-log_ratio)[mask].mean().item()
                    fraction=((ratio-1).abs()>clip)[mask].float().mean().item()
                if not torch.isfinite(loss):raise FloatingPointError('Nonfinite recurrent PPO loss')
                if self.target_kl is not None and kl>1.5*self.target_kl:
                    continue_training=False;break
                self.policy.optimizer.zero_grad()
                loss.backward()
                norm=torch.nn.utils.clip_grad_norm_(self.policy.parameters(),self.max_grad_norm)
                if not torch.isfinite(norm):raise FloatingPointError('Nonfinite recurrent gradient')
                self.policy.optimizer.step()
                for key,value in zip(logs,(entropy_loss.item(),policy_loss.item(),value_loss.item(),kl,fraction,float(norm))):
                    logs[key].append(value)
                learned+=b['valid_tokens'];warm+=b['warm_tokens'];padding+=b['padding_tokens'];updates+=1
            self._n_updates+=1
            if not continue_training:break
        for key,values in logs.items():
            if values:self.logger.record('train/'+key,float(np.mean(values)))
        self.logger.record('train/explained_variance',explained_variance(self.rollout_buffer.values.flatten(),self.rollout_buffer.returns.flatten()))
        self.logger.record('train/std',self.policy.log_std.exp().mean().item())
        self.logger.record('train/n_updates',self._n_updates,exclude='tensorboard')
        self.logger.record('train/clip_range',clip)
        self.logger.record('recurrent/learning_tokens',learned)
        self.logger.record('recurrent/burn_in_tokens',warm)
        self.logger.record('recurrent/padding_tokens',padding)
        self.logger.record('recurrent/optimizer_steps',updates)
        self.logger.record('recurrent/learning_chunk_max',128)
        self.logger.record('recurrent/burn_in_max',32)
